import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { InMemoryPersonalTokenStore, PersonalTokenVerifier, hashToken } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'
import type { Clock } from '@/shared/kernel'

let now = new Date('2026-01-01T00:00:00Z')
const clock: Clock = { now: () => now }
const owner = { userId: 'ana', tenantId: 't1', scopes: ['resources:read'] }

describe('PersonalTokenVerifier', () => {
  let store: InMemoryPersonalTokenStore
  let verifier: PersonalTokenVerifier

  beforeEach(() => {
    now = new Date('2026-01-01T00:00:00Z')
    store = new InMemoryPersonalTokenStore(clock)
    verifier = new PersonalTokenVerifier(store, clock)
  })
  afterEach(() => {
    delete process.env.APP_ENV
  })

  it('emite pat_… e guarda só o hash SHA-256', async () => {
    const token = await store.issue(owner)
    expect(token).toMatch(/^pat_[A-Za-z0-9_-]{32,}$/)
    const record = await store.findByHash(hashToken(token))
    expect(record?.tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(record)).not.toContain(token)
  })

  it('token válido → AuthUser via pat e marca lastUsedAt', async () => {
    const token = await store.issue(owner)
    expect(await verifier.verify(token)).toEqual({ id: 'ana', tenantId: 't1', scopes: ['resources:read'], via: 'pat' })
    expect((await store.findByHash(hashToken(token)))?.lastUsedAt).toEqual(now)
  })

  it('token desconhecido → UnauthorizedError', async () => {
    await expect(verifier.verify('pat_nao_existe_nao_existe_nao_existe')).rejects.toThrow(UnauthorizedError)
  })

  it('token expirado → UnauthorizedError', async () => {
    const token = await store.issue({ ...owner, expiresAt: new Date('2026-01-02T00:00:00Z') })
    now = new Date('2026-01-02T00:00:00Z')
    await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedError)
  })

  it('validade padrão de 90 dias', async () => {
    const token = await store.issue(owner)
    expect((await store.findByHash(hashToken(token)))?.expiresAt).toEqual(new Date('2026-04-01T00:00:00Z'))
  })

  it('token revogado → UnauthorizedError', async () => {
    const token = await store.issue(owner)
    await store.revoke(token)
    await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedError)
  })

  it('token devOnly só vale com APP_ENV=development', async () => {
    const token = await store.issue({ ...owner, devOnly: true, token: 'pat_dev_local_dev_local_dev_local_0' })
    await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedError)
    process.env.APP_ENV = 'development'
    expect((await verifier.verify(token)).id).toBe('ana')
  })

  it('token pré-definido só é aceito como devOnly (nunca fixa um PAT de UAT/Prod)', async () => {
    const chosen = 'pat_escolhido_escolhido_escolhido_escolhido'
    await expect(store.issue({ ...owner, token: chosen })).rejects.toThrow('devOnly')
  })

  it('devOnly segue o env injetado no verificador, não o process.env', async () => {
    const token = await store.issue({ ...owner, devOnly: true, token: 'pat_dev_local_dev_local_dev_local_0' })
    process.env.APP_ENV = 'development'
    await expect(new PersonalTokenVerifier(store, clock, {}).verify(token)).rejects.toThrow(UnauthorizedError)
    delete process.env.APP_ENV
    const devVerifier = new PersonalTokenVerifier(store, clock, { APP_ENV: 'development' })
    expect((await devVerifier.verify(token)).id).toBe('ana')
  })

  it('rejeita token pré-definido sem prefixo pat_ ou curto', async () => {
    await expect(store.issue({ ...owner, devOnly: true, token: 'curto' })).rejects.toThrow('pat_')
  })
})
