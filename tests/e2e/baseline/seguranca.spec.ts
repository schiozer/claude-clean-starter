// Baseline de hardening (docs/rnf.md, RNF-SEG-*): headers, cookie, fail-closed, erro sem vazamento,
// rate limit e o 401 do MCP. Roda no projeto `sistemico` (só `request`, sem navegador).
import { expect, test } from '@playwright/test'
import { e2eEnv, parametro, perfis, rnfMs, telas } from '../support'
import { chamarMcp, chamarTool, exigir, parametroInteiro, parametroLista } from './apoio'

test.describe('com sessão do usuário', () => {
  test.use({ storageState: perfis.usuario })

  test(
    'RNF-SEG-001 headers de hardening em toda tela',
    { tag: ['@rnf', '@regressao'] },
    async ({ request }) => {
      for (const { rota } of telas()) {
        const res = await request.get(rota)
        expect(res.status(), `${rota}: status`).toBe(200)
        expect(res.headers()['content-type'], `${rota}: é HTML`).toContain('text/html')
        const h = res.headers()
        expect(h['content-security-policy'], `${rota}: Content-Security-Policy`).toBeTruthy()
        expect(h['strict-transport-security'], `${rota}: Strict-Transport-Security`).toBeTruthy()
        expect(h['x-content-type-options'], `${rota}: X-Content-Type-Options`).toBe('nosniff')
        expect(h['referrer-policy'], `${rota}: Referrer-Policy`).toBeTruthy()
        const antiFrame =
          /frame-ancestors/.test(h['content-security-policy'] ?? '') ||
          Boolean(h['x-frame-options'])
        expect(antiFrame, `${rota}: frame-ancestors no CSP ou X-Frame-Options`).toBe(true)
      }
    }
  )

  test(
    'RNF-SEG-002 cookie de sessão Secure, HttpOnly e SameSite',
    { tag: ['@rnf', '@regressao'] },
    async ({ request }) => {
      const nome = parametro('cookieDeSessao')
      const { cookies } = await request.storageState()
      const cookie = cookies.find((c) => c.name === nome)
      expect(cookie, `cookie ${nome} após o login`).toBeDefined()
      expect(cookie?.httpOnly, 'HttpOnly').toBe(true)
      expect(cookie?.secure, 'Secure').toBe(true)
      expect(['Lax', 'Strict'], 'SameSite Lax ou Strict').toContain(cookie?.sameSite)
    }
  )
})

test(
  'RNF-SEG-003 api fail-closed: 401 sem identidade e erro sem escopo',
  { tag: ['@rnf', '@regressao'] },
  async ({ request }) => {
    const protegida = await request.get(parametro('rotaProtegida'))
    expect(protegida.status(), 'rota protegida sem sessão nem token').toBe(401)

    for (const rota of parametroLista('rotasPublicas')) {
      expect((await request.get(rota)).status(), `rota pública ${rota}`).not.toBe(401)
    }

    const semEscopo = exigir(e2eEnv().pat.semEscopo, 'E2E_PAT_SEM_ESCOPO')
    const result = await chamarTool(request, semEscopo, 'list_resources')
    expect(result.isError, 'tools/call sem escopo é recusada').toBe(true)
    expect(result._meta?.code).toBe('FORBIDDEN')
    expect(result.structuredContent, 'sem dados na recusa').toBeUndefined()
  }
)

test(
  'RNF-SEG-004 erro técnico sem stack trace nem mensagem interna',
  { tag: ['@rnf', '@regressao'] },
  async ({ request }) => {
    const segredo = exigir(e2eEnv().faultsSecret, 'E2E_FAULTS_SECRET')
    const res = await request.get(parametro('rotaProtegida'), {
      headers: { 'x-e2e-delay-ms': String(rnfMs('RNF-TMO-001') + 1000), 'x-e2e-secret': segredo },
    })
    expect(res.status(), 'erro técnico').toBeGreaterThanOrEqual(500)
    const texto = await res.text()
    const corpo = JSON.parse(texto) as Record<string, unknown>
    expect(Object.keys(corpo).sort(), 'corpo só { error, code }').toEqual(['code', 'error'])
    expect(typeof corpo.error).toBe('string')
    expect(typeof corpo.code).toBe('string')
    for (const vazamento of ['at ', 'Error:', '/src/']) {
      expect(texto, `sem '${vazamento}' no corpo`).not.toContain(vazamento)
    }
  }
)

test(
  'RNF-SEG-005 rate limit por ator no MCP',
  { tag: ['@rnf', '@regressao'] },
  async ({ request }) => {
    const token = exigir(e2eEnv().pat.rateLimit, 'E2E_PAT_RATE_LIMIT')
    const limite = parametroInteiro('limiteDeTaxaMcp')
    const codigos: (string | undefined)[] = []
    for (let i = 0; i <= limite; i++) {
      const result = await chamarTool(request, token, 'list_resources')
      codigos.push(result.isError ? result._meta?.code : 'ok')
    }
    expect(
      codigos.filter((c) => c !== 'ok' && c !== 'RATE_LIMITED'),
      'só sucesso ou RATE_LIMITED'
    ).toEqual([])
    expect(
      codigos.filter((c) => c === 'ok').length,
      `no máximo ${limite} por janela`
    ).toBeLessThanOrEqual(limite)
    expect(codigos.at(-1), `chamada ${limite + 1} acima do limite`).toBe('RATE_LIMITED')
  }
)

test(
  'RNF-SEG-006 mcp sem token responde 401 com resource_metadata',
  { tag: ['@rnf', '@regressao'] },
  async ({ request }) => {
    const res = await chamarMcp(request, null, 'tools/list')
    expect(res.status()).toBe(401)
    const desafio = res.headers()['www-authenticate'] ?? ''
    expect(desafio).toMatch(/^Bearer /)
    expect(desafio).toContain('resource_metadata=')
  }
)
