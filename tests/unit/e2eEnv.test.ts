import { describe, it, expect } from 'vitest'
import { cabecalhosDeBypass, e2eEnv, origemDoAlvo } from '../e2e/support/env'

describe('e2eEnv', () => {
  it('sem variáveis: alvo local, login dev e nada de segredo', () => {
    expect(e2eEnv({})).toEqual({
      baseUrl: null,
      auth: 'dev',
      bypass: null,
      faultsSecret: null,
      runPrefix: '',
      pat: { usuario: null, semEscopo: null, rateLimit: null, outroAtor: null },
    })
  })

  it('E2E_AUTH=auth0 liga o Universal Login; vazio ou dev usa o login dev', () => {
    expect(e2eEnv({ E2E_AUTH: 'auth0' }).auth).toBe('auth0')
    expect(e2eEnv({ E2E_AUTH: ' auth0 ' }).auth).toBe('auth0')
    expect(e2eEnv({ E2E_AUTH: 'dev' }).auth).toBe('dev')
    expect(e2eEnv({ E2E_AUTH: '' }).auth).toBe('dev')
  })

  it.each(['qualquer', 'Auth0', 'devv'])('E2E_AUTH=%s (desconhecido) lança erro claro', (valor) => {
    expect(() => e2eEnv({ E2E_AUTH: valor })).toThrow(
      `E2E_AUTH='${valor}' inválido: use 'dev' (ou vazio) ou 'auth0'`
    )
  })

  it('docs:gerar (E2E_DOCS=1) com E2E_BASE_URL falha cedo: só roda local', () => {
    expect(() => e2eEnv({ E2E_DOCS: '1', E2E_BASE_URL: 'https://app-git-x.vercel.app' })).toThrow(
      /docs:gerar só roda local/
    )
    expect(e2eEnv({ E2E_DOCS: '1', E2E_BASE_URL: ' ' }).baseUrl).toBeNull()
    expect(e2eEnv({ E2E_BASE_URL: 'https://app-git-x.vercel.app' }).baseUrl).not.toBeNull()
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
        E2E_PAT_SEM_ESCOPO: ' pat_sem ',
        E2E_PAT_RATE_LIMIT: 'pat_rl',
        E2E_PAT_OUTRO_ATOR: ' pat_outro ',
      })
    ).toEqual({
      baseUrl: 'https://app-git-x.vercel.app',
      auth: 'dev',
      bypass: 'bypass-123',
      faultsSecret: 'faults-secret-0123456789',
      runPrefix: '987',
      pat: {
        usuario: 'pat_abc',
        semEscopo: 'pat_sem',
        rateLimit: 'pat_rl',
        outroAtor: 'pat_outro',
      },
    })
  })

  it('segredos vazios contam como ausentes', () => {
    const env = e2eEnv({ VERCEL_AUTOMATION_BYPASS_SECRET: '', E2E_FAULTS_SECRET: '' })
    expect(env.bypass).toBeNull()
    expect(env.faultsSecret).toBeNull()
  })

  it('PATs vazios contam como ausentes', () => {
    expect(
      e2eEnv({
        E2E_PAT_USUARIO: '',
        E2E_PAT_SEM_ESCOPO: '  ',
        E2E_PAT_RATE_LIMIT: '',
        E2E_PAT_OUTRO_ATOR: ' ',
      }).pat
    ).toEqual({ usuario: null, semEscopo: null, rateLimit: null, outroAtor: null })
  })
})

describe('bypass da Vercel só para a origem do preview', () => {
  it('sem segredo de bypass (modo local) → sem cabeçalhos', () => {
    expect(cabecalhosDeBypass(e2eEnv({}))).toBeNull()
    expect(cabecalhosDeBypass(e2eEnv({ E2E_BASE_URL: 'https://app-git-x.vercel.app' }))).toBeNull()
  })

  it('com segredo → os dois cabeçalhos da Vercel', () => {
    const env = e2eEnv({ VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-123' })
    expect(cabecalhosDeBypass(env)).toEqual({
      'x-vercel-protection-bypass': 'bypass-123',
      'x-vercel-set-bypass-cookie': 'true',
    })
  })

  it('origemDoAlvo casa só a origem exata do baseURL (Auth0, CDN e terceiros ficam de fora)', () => {
    const doAlvo = origemDoAlvo('https://app-git-x.vercel.app/')
    expect(doAlvo(new URL('https://app-git-x.vercel.app/api/resources?x=1'))).toBe(true)
    expect(doAlvo(new URL('https://tenant.us.auth0.com/u/login'))).toBe(false)
    expect(doAlvo(new URL('https://cdn.example.com/app-git-x.vercel.app/a.js'))).toBe(false)
    expect(doAlvo(new URL('https://app-git-x.vercel.app.evil.com/'))).toBe(false)
    expect(doAlvo(new URL('http://app-git-x.vercel.app/'))).toBe(false)
  })
})
