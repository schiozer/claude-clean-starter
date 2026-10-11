import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { UnauthorizedError } from '@/shared/errors'
import type { AuthUser } from './AuthUser'
import type { IAccessTokenVerifier } from './IAccessTokenVerifier'

export interface Auth0JwtVerifierOptions {
  issuer: string
  /** URL do MCP do ambiente (= audience da API no Auth0). */
  audience: string
  /** Injete um JWKS local em teste; em runtime usa o JWKS remoto do issuer. */
  jwks?: JWTVerifyGetKey
  tenantClaim?: string
}

const remoteJwksByIssuer = new Map<string, JWTVerifyGetKey>()

function remoteJwks(issuer: string): JWTVerifyGetKey {
  let jwks = remoteJwksByIssuer.get(issuer)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', issuer))
    remoteJwksByIssuer.set(issuer, jwks)
  }
  return jwks
}

export class Auth0JwtVerifier implements IAccessTokenVerifier {
  private readonly issuer: string
  private readonly jwks: JWTVerifyGetKey

  constructor(private readonly options: Auth0JwtVerifierOptions) {
    this.issuer = options.issuer.endsWith('/') ? options.issuer : `${options.issuer}/`
    this.jwks = options.jwks ?? remoteJwks(this.issuer)
  }

  async verify(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.options.audience,
        algorithms: ['RS256'],
      })
      if (!payload.sub) throw new UnauthorizedError('Token sem sub')
      const tenant = payload[this.options.tenantClaim ?? 'tenant_id']
      const scope = typeof payload.scope === 'string' ? payload.scope : ''
      return {
        id: payload.sub,
        tenantId: typeof tenant === 'string' && tenant ? tenant : payload.sub,
        scopes: scope.split(' ').filter(Boolean),
        via: 'oauth',
      }
    } catch (error) {
      if (error instanceof errors.JOSEError) throw new UnauthorizedError('Token inválido ou expirado')
      throw error
    }
  }
}
