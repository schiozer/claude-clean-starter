import { describe, it, expect, vi } from 'vitest'
import { CompositeTokenVerifier, readBearerToken, type IAccessTokenVerifier } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'
import { makeActor } from '../helpers/makeActor'

const withAuth = (value?: string) =>
  new Request('http://localhost/api/mcp', { headers: value ? { authorization: value } : {} })

const fake = (via: 'pat' | 'oauth'): IAccessTokenVerifier => ({
  verify: vi.fn(async () => makeActor({ via })),
})

describe('readBearerToken', () => {
  it('lê o token do header Authorization', () => {
    expect(readBearerToken(withAuth('Bearer abc'))).toBe('abc')
    expect(readBearerToken(withAuth('bearer abc'))).toBe('abc')
  })
  it('ausente, vazio ou outro esquema → null', () => {
    expect(readBearerToken(withAuth())).toBeNull()
    expect(readBearerToken(withAuth('Bearer   '))).toBeNull()
    expect(readBearerToken(withAuth('Basic abc'))).toBeNull()
  })
})

describe('CompositeTokenVerifier', () => {
  it('pat_ → PersonalTokenVerifier', async () => {
    const pat = fake('pat')
    const jwt = fake('oauth')
    expect((await new CompositeTokenVerifier(pat, jwt).verify('pat_x')).via).toBe('pat')
    expect(jwt.verify).not.toHaveBeenCalled()
  })
  it('outro formato → verificador JWT', async () => {
    expect((await new CompositeTokenVerifier(fake('pat'), fake('oauth')).verify('eyJ...')).via).toBe('oauth')
  })
  it('sem verificador JWT configurado → UnauthorizedError', async () => {
    await expect(new CompositeTokenVerifier(fake('pat'), null).verify('eyJ...')).rejects.toThrow(UnauthorizedError)
  })
})
