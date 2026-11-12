import { describe, it, expect } from 'vitest'
import { e2eDelayMs, e2eFault, E2E_FAULT_SENTINEL } from '@/shared/http/e2eFaults'

const req = (secret: string | undefined, delay: string) =>
  new Request('http://localhost/api/resources', {
    headers: {
      'x-e2e-delay-ms': delay,
      ...(secret === undefined ? {} : { 'x-e2e-secret': secret }),
    },
  })

const reqFalha = (secret: string | undefined, fault: string) =>
  new Request('http://localhost/api/resources', {
    headers: {
      'x-e2e-fault': fault,
      ...(secret === undefined ? {} : { 'x-e2e-secret': secret }),
    },
  })

describe('e2eDelayMs', () => {
  it.each([
    [{ APP_ENV: 'production', E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), '500', 0],
    [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, undefined, '500', 0],
    [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 'curto' }, 'curto', '500', 0],
    [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), '500', 500],
    [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), '999999', 60000],
  ])('e2eDelayMs(env=%o, segredo=%s, atraso=%s) = %i', (env, secret, delay, esperado) => {
    expect(e2eDelayMs(req(secret, delay), env)).toBe(esperado)
  })

  it('segredo errado, APP_ENV ausente ou atraso inválido → 0', () => {
    const env = { APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }
    expect(e2eDelayMs(req('t'.repeat(16), '500'), env)).toBe(0)
    expect(e2eDelayMs(req('s'.repeat(16), '500'), { E2E_FAULTS_SECRET: 's'.repeat(16) })).toBe(0)
    for (const delay of ['abc', '-5', '1.5', '']) {
      expect(e2eDelayMs(req('s'.repeat(16), delay), env)).toBe(0)
    }
  })

  it('sem header de atraso → 0', () => {
    const env = { APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }
    expect(e2eDelayMs(new Request('http://localhost/'), env)).toBe(0)
  })
})

describe('e2eFault', () => {
  it.each([
    [{ APP_ENV: 'production', E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), 'throw', null],
    [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, undefined, 'throw', null],
    [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 'curto' }, 'curto', 'throw', null],
    [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, 't'.repeat(16), 'throw', null],
    [{ E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), 'throw', null],
    [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), 'outra', null],
    [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), 'throw', 'throw'],
  ])('e2eFault(env=%o, segredo=%s, falha=%s) = %s', (env, secret, fault, esperado) => {
    expect(e2eFault(reqFalha(secret, fault), env)).toBe(esperado)
  })

  it.each(['e2e', 'uat', 'dev', 'development'])(
    'APP_ENV=%s (allowlist) abre o portão',
    (appEnv) => {
      const env = { APP_ENV: appEnv, E2E_FAULTS_SECRET: 's'.repeat(16) }
      expect(e2eFault(reqFalha('s'.repeat(16), 'throw'), env)).toBe('throw')
      expect(e2eDelayMs(req('s'.repeat(16), '500'), env)).toBe(500)
    }
  )

  it.each(['production', 'prod', 'PROD', 'staging', 'UAT', ' uat', ''])(
    'APP_ENV=%j (fora da allowlist) fecha o portão',
    (appEnv) => {
      const env = { APP_ENV: appEnv, E2E_FAULTS_SECRET: 's'.repeat(16) }
      expect(e2eFault(reqFalha('s'.repeat(16), 'throw'), env)).toBeNull()
      expect(e2eDelayMs(req('s'.repeat(16), '500'), env)).toBe(0)
    }
  )

  it('sem header de falha → null', () => {
    const env = { APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }
    expect(e2eFault(new Request('http://localhost/'), env)).toBeNull()
  })

  it('a sentinela imita o vazamento real (SQL + caminho de código)', () => {
    expect(E2E_FAULT_SENTINEL).toContain('/src/')
    expect(E2E_FAULT_SENTINEL).toContain('SELECT')
  })
})
