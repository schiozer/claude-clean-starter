import { describe, it, expect, afterEach } from 'vitest'
import { StubAuthProvider, makeSessionResolver } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'

const req = new Request('http://localhost/api/resources')
const resolve = makeSessionResolver(new StubAuthProvider())

describe('StubAuthProvider + makeSessionResolver', () => {
  afterEach(() => {
    delete process.env.APP_ENV
  })

  it('no Dev local resolve o dev-user com escopos de resources', async () => {
    process.env.APP_ENV = 'development'
    expect(await resolve(req)).toEqual({
      id: 'dev-user',
      tenantId: 'dev-tenant',
      scopes: ['resources:read', 'resources:write'],
      via: 'session',
    })
  })

  it('fora do Dev (APP_ENV ausente) → UnauthorizedError (stub nunca vale em UAT/Prod)', async () => {
    await expect(resolve(req)).rejects.toThrow(UnauthorizedError)
  })

  it('APP_ENV=uat → UnauthorizedError', async () => {
    process.env.APP_ENV = 'uat'
    await expect(resolve(req)).rejects.toThrow(UnauthorizedError)
  })
})
