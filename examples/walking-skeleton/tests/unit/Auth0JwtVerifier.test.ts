import { describe, it, expect, beforeAll } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose'
import { Auth0JwtVerifier } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'

const ISSUER = 'https://tenant.example.auth0.com/'
const AUDIENCE = 'https://uat.example.com/api/mcp'

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let privateKey: Key
let otherKey: Key
let jwks: JWTVerifyGetKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  otherKey = (await generateKeyPair('RS256')).privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }
  jwks = createLocalJWKSet({ keys: [jwk] })
})

function sign(claims: Record<string, unknown>, opts: { aud?: string | string[]; iss?: string; exp?: string; key?: Key } = {}) {
  return new SignJWT({ scope: 'resources:read', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('auth0|ana')
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey)
}

const verifier = () => new Auth0JwtVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks })

describe('Auth0JwtVerifier', () => {
  it('token válido → AuthUser via oauth com escopos', async () => {
    expect(await verifier().verify(await sign({}))).toEqual({
      id: 'auth0|ana',
      tenantId: 'auth0|ana',
      scopes: ['resources:read'],
      via: 'oauth',
    })
  })

  it('aceita aud em array que contém a URL do MCP', async () => {
    const token = await sign({}, { aud: ['https://tenant.example.auth0.com/userinfo', AUDIENCE] })
    expect((await verifier().verify(token)).id).toBe('auth0|ana')
  })

  it('usa a claim de tenant quando presente', async () => {
    expect((await verifier().verify(await sign({ tenant_id: 'acme' }))).tenantId).toBe('acme')
  })

  it('aud sem a URL do MCP → UnauthorizedError', async () => {
    await expect(verifier().verify(await sign({}, { aud: 'https://outra-api' }))).rejects.toThrow(UnauthorizedError)
  })

  it('iss errado → UnauthorizedError', async () => {
    await expect(verifier().verify(await sign({}, { iss: 'https://evil.auth0.com/' }))).rejects.toThrow(UnauthorizedError)
  })

  it('expirado → UnauthorizedError', async () => {
    await expect(verifier().verify(await sign({}, { exp: '-1m' }))).rejects.toThrow(UnauthorizedError)
  })

  it('assinado por outra chave → UnauthorizedError', async () => {
    await expect(verifier().verify(await sign({}, { key: otherKey }))).rejects.toThrow(UnauthorizedError)
  })

  it('lixo no lugar do token → UnauthorizedError', async () => {
    await expect(verifier().verify('nao.e.jwt')).rejects.toThrow(UnauthorizedError)
  })

  it('issuer sem barra final é normalizado', async () => {
    const v = new Auth0JwtVerifier({ issuer: 'https://tenant.example.auth0.com', audience: AUDIENCE, jwks })
    expect((await v.verify(await sign({}))).via).toBe('oauth')
  })
})
