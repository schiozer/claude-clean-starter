import { describe, it, expect } from 'vitest'
import { e2eEnv } from '../e2e/support/env'

describe('e2eEnv', () => {
  it('sem variáveis: alvo local, login dev e nada de segredo', () => {
    expect(e2eEnv({})).toEqual({
      baseUrl: null,
      auth: 'dev',
      bypass: null,
      faultsSecret: null,
      runPrefix: '',
      pat: { usuario: null },
    })
  })

  it('E2E_AUTH=auth0 liga o Universal Login; outro valor cai no dev', () => {
    expect(e2eEnv({ E2E_AUTH: 'auth0' }).auth).toBe('auth0')
    expect(e2eEnv({ E2E_AUTH: 'qualquer' }).auth).toBe('dev')
  })

  it('E2E_BASE_URL vazio ou só espaços → null (sobe o webServer local)', () => {
    expect(e2eEnv({ E2E_BASE_URL: '' }).baseUrl).toBeNull()
    expect(e2eEnv({ E2E_BASE_URL: '   ' }).baseUrl).toBeNull()
  })

  it('lê alvo, bypass da Vercel, segredo de falhas, prefixo e PAT', () => {
    expect(
      e2eEnv({
        E2E_BASE_URL: ' https://app-git-x.vercel.app ',
        VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-123',
        E2E_FAULTS_SECRET: 'faults-secret-0123456789',
        E2E_RUN_PREFIX: '987',
        E2E_PAT_USUARIO: 'pat_abc',
      })
    ).toEqual({
      baseUrl: 'https://app-git-x.vercel.app',
      auth: 'dev',
      bypass: 'bypass-123',
      faultsSecret: 'faults-secret-0123456789',
      runPrefix: '987',
      pat: { usuario: 'pat_abc' },
    })
  })

  it('segredos vazios contam como ausentes', () => {
    const env = e2eEnv({ VERCEL_AUTOMATION_BYPASS_SECRET: '', E2E_FAULTS_SECRET: '' })
    expect(env.bypass).toBeNull()
    expect(env.faultsSecret).toBeNull()
  })
})
