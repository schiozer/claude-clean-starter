// Baseline de timeout (docs/rnf.md, RNF-TMO-*): o prazo da rota de API (injeção de lentidão só
// fora de Prod) e a UI que desiste da chamada. Roda no projeto `sistemico`.
import { e2eEnv, parametro, perfis, rnfMs, expect, test } from '../support'
import { exigir } from './apoio'

test(
  'RNF-TMO-001 rota de api estoura o prazo com erro tratado',
  { tag: ['@rnf', '@regressao'] },
  async ({ request }) => {
    const prazo = rnfMs('RNF-TMO-001')
    test.setTimeout(prazo + 30_000)
    const segredo = exigir(e2eEnv().faultsSecret, 'E2E_FAULTS_SECRET')
    const inicio = Date.now()
    const res = await request.get(parametro('rotaProtegida'), {
      headers: { 'x-e2e-delay-ms': String(prazo + 1000), 'x-e2e-secret': segredo },
      timeout: prazo + 10_000,
    })
    const decorrido = Date.now() - inicio
    expect(res.status()).toBe(504)
    expect(await res.json()).toMatchObject({ code: 'TIMEOUT' })
    expect(decorrido, `responde em < prazo + 3 s (${decorrido} ms)`).toBeLessThan(prazo + 3000)
  }
)

test.describe('na tela, desktop', () => {
  test.use({ storageState: perfis.usuario, viewport: { width: 1280, height: 800 } })

  test(
    'RNF-TMO-002 ui desiste da chamada e mostra tente novamente',
    { tag: ['@rnf', '@regressao'] },
    async ({ page }) => {
      const prazo = rnfMs('RNF-TMO-002')
      const rota = parametro('rotaProtegida')
      await page.clock.install()
      let chegou: () => void = () => {}
      const chamadaFeita = new Promise<void>((resolve) => (chegou = resolve))
      // Nunca responde: só o prazo da UI encerra a chamada.
      await page.route(`**${rota}`, () => chegou())

      await page.goto(parametro('telaComApi'))
      await chamadaFeita
      // Filtra pelo texto: o anunciador de rota do framework também é um `role="alert"` (vazio).
      const tenteNovamente = page.getByRole('alert').filter({ hasText: 'Tente novamente' })
      await page.clock.fastForward(prazo - 1000)
      expect(await tenteNovamente.count(), 'não desiste antes do prazo').toBe(0)
      await page.clock.fastForward(1000)
      await expect(tenteNovamente).toBeVisible()

      await page.unrouteAll({ behavior: 'ignoreErrors' })
    }
  )
})
