// Baseline de hardening (docs/rnf.md, RNF-SEG-*): headers, cookie, fail-closed, erro sem vazamento,
// rate limit e o 401 do MCP. Roda no projeto `sistemico` (só `request`, sem navegador).
import { expect, test } from '@playwright/test'
import { e2eEnv, parametro, perfis, telasExigidas } from '../support'
import { chamarMcp, chamarTool, comTrava, exigir, parametroInteiro, parametroLista } from './apoio'

test.describe('com sessão do usuário', () => {
  test.use({ storageState: perfis.usuario })

  test(
    'RNF-SEG-001 headers de hardening em toda tela',
    { tag: ['@rnf', '@regressao'] },
    async ({ request }) => {
      for (const { rota } of telasExigidas()) {
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

// Contrato com a falha injetada do app (`x-e2e-fault: throw`, ver `e2eFaults.ts` do skeleton): a
// rota lança um `Error` cru com SQL e caminho de código na mensagem — nada disso pode sair na resposta.
const SENTINELA = 'SELECT * FROM segredo /src/sentinela.ts'

test(
  'RNF-SEG-004 erro técnico sem stack trace nem mensagem interna',
  { tag: ['@rnf', '@regressao'] },
  async ({ request }) => {
    const segredo = exigir(e2eEnv().faultsSecret, 'E2E_FAULTS_SECRET')
    const res = await request.get(parametro('rotaProtegida'), {
      headers: { 'x-e2e-fault': 'throw', 'x-e2e-secret': segredo },
    })
    expect(res.status(), 'erro técnico (falha injetada)').toBe(500)
    const texto = await res.text()
    const corpo = JSON.parse(texto) as Record<string, unknown>
    expect(Object.keys(corpo).sort(), 'corpo só { error, code }').toEqual(['code', 'error'])
    expect(typeof corpo.error).toBe('string')
    expect(typeof corpo.code).toBe('string')
    for (const vazamento of [SENTINELA, 'SELECT', 'sentinela', 'at ', 'Error:', '/src/']) {
      expect(texto, `sem '${vazamento}' no corpo`).not.toContain(vazamento)
    }
  }
)

const ESPERA_JANELA_MS = 65_000

// O limiter do skeleton é em memória e **por instância**: em UAT com várias instâncias cada uma conta
// a sua janela, e o limite efetivo vira N × limite — lá é preciso um limiter compartilhado (ADR-010).
test(
  'RNF-SEG-005 rate limit por ator no MCP',
  { tag: ['@rnf', '@regressao'] },
  async ({ request }) => {
    test.setTimeout(3 * ESPERA_JANELA_MS + 60_000)
    const token = exigir(e2eEnv().pat.rateLimit, 'E2E_PAT_RATE_LIMIT')
    const limite = parametroInteiro('limiteDeTaxaMcp')
    const esperado = [...Array<string>(limite).fill('ok'), 'RATE_LIMITED']

    const chamar = async (): Promise<string> => {
      const result = await chamarTool(request, token, 'list_resources')
      return result.isError ? (result._meta?.code ?? 'sem código') : 'ok'
    }
    /** Chamadas seguidas até o 1º não-ok ou `limite + 1` chamadas. */
    const rajada = async (inicio: string[] = []): Promise<string[]> => {
      const codigos = [...inicio]
      while (codigos.length <= limite && (codigos.length === 0 || codigos.at(-1) === 'ok')) {
        codigos.push(await chamar())
      }
      return codigos
    }

    // Uma medição por vez na máquina: duas cópias do teste (ex.: `--repeat-each`) dividiriam a janela.
    await comTrava('rnf-seg-005', 2 * ESPERA_JANELA_MS, async () => {
      let codigos = await rajada()
      // Limitada antes de `limite` sucessos: janela já (parcialmente) consumida por um retry ou
      // `--repeat-each`. Espera zerar e mede de novo numa janela limpa.
      if (codigos.at(-1) === 'RATE_LIMITED' && codigos.length < esperado.length) {
        test.info().annotations.push({
          type: 'RNF-SEG-005',
          description: `janela herdada (${codigos.length - 1} sucesso(s) antes do limite); aguardando zerar`,
        })
        const fim = Date.now() + ESPERA_JANELA_MS
        let primeira = 'RATE_LIMITED'
        while (primeira === 'RATE_LIMITED' && Date.now() < fim) {
          await new Promise((r) => setTimeout(r, 1_000))
          primeira = await chamar()
        }
        if (primeira === 'RATE_LIMITED') {
          throw new Error(
            `RNF-SEG-005: a janela do rate limit não zerou em ${ESPERA_JANELA_MS / 1000} s (ainda RATE_LIMITED)`
          )
        }
        codigos = await rajada([primeira])
      }
      expect(
        codigos,
        `exatamente ${limite} sucessos e a chamada ${limite + 1} RATE_LIMITED`
      ).toEqual(esperado)
    })
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
