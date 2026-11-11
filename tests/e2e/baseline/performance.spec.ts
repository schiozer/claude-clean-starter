// Baseline de performance (docs/rnf.md, RNF-PRF-*): orçamento por requisição da API do caminho
// feliz e LCP das telas no perfil mobile. Roda no projeto `sistemico`, com a sessão do usuário e o
// iPhone de referência em Chromium (o mesmo do projeto `mobile`).
import { devices, expect, test, type Page } from '@playwright/test'
import { parametro, perfis, rnfMs, telasExigidas } from '../support'
import { orcamentoComMargem } from './apoio'

test.use({ ...devices['iPhone 13'], defaultBrowserType: 'chromium', storageState: perfis.usuario })

const AMOSTRAS = 3
const ESPERA_LCP_MS = 10_000

test(
  'RNF-PRF-001 api do caminho feliz responde no orçamento',
  { tag: ['@rnf', '@regressao'] },
  async ({ request }) => {
    const rota = parametro('rotaProtegida')
    const orcamento = orcamentoComMargem(rnfMs('RNF-PRF-001'))
    const tempos: number[] = []
    // A 1ª chamada aquece (compilação/conexão) e é descartada.
    for (let i = 0; i <= AMOSTRAS; i++) {
      const inicio = Date.now()
      const res = await request.get(rota)
      tempos.push(Date.now() - inicio)
      expect(res.status(), `${rota}: caminho feliz`).toBe(200)
    }
    const amostras = tempos.slice(1)
    const media = amostras.reduce((a, b) => a + b, 0) / amostras.length
    expect(media, `média ${media.toFixed(0)} ms (${amostras.join(', ')})`).toBeLessThan(orcamento)
  }
)

/** Último LCP registrado na página (buffered); sem registro em `ESPERA_LCP_MS` → erro. */
const medirLcp = (page: Page): Promise<number> =>
  page.evaluate(
    (espera) =>
      new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('nenhum largest-contentful-paint')), espera)
        new PerformanceObserver((lista) => {
          const entradas = lista.getEntries()
          const ultima = entradas[entradas.length - 1]
          if (!ultima) return
          clearTimeout(timer)
          resolve(ultima.startTime)
        }).observe({ type: 'largest-contentful-paint', buffered: true })
      }),
    ESPERA_LCP_MS
  )

test(
  'RNF-PRF-002 lcp das telas no perfil mobile',
  { tag: ['@rnf', '@regressao'] },
  async ({ page }) => {
    const orcamento = orcamentoComMargem(rnfMs('RNF-PRF-002'))
    for (const { rota, nome } of telasExigidas()) {
      await page.goto(rota, { waitUntil: 'load' })
      expect(new URL(page.url()).pathname, `${nome}: abriu a tela (sessão válida)`).toBe(rota)
      const lcp = await medirLcp(page)
      expect(lcp, `${nome} (${rota}): LCP ${lcp.toFixed(0)} ms`).toBeLessThan(orcamento)
    }
  }
)
