// `test` e `expect` da suíte E2E: os do Playwright mais o bypass da Vercel restrito à origem do
// preview (spec e2e-regressao-docs §8.2; R24). Testes importam `test`/`expect` de `support`, não
// de `@playwright/test`. No modo local (sem `VERCEL_AUTOMATION_BYPASS_SECRET`) nada muda.
import { test as base, expect } from '@playwright/test'
import { cabecalhosDeBypass, e2eEnv, origemDoAlvo } from './env'

export const test = base.extend({
  /**
   * Navegador: os cabeçalhos de bypass entram só nas requisições à origem do `baseURL`. Auth0, CDN
   * e terceiros não recebem o segredo (nem pagam preflight de CORS). A 1ª resposta grava o cookie
   * de bypass, que cobre também o `page.request` do contexto.
   */
  context: async ({ context, baseURL }, use) => {
    const cabecalhos = cabecalhosDeBypass(e2eEnv())
    if (cabecalhos && baseURL) {
      await context.route(origemDoAlvo(baseURL), (route) =>
        route.fallback({ headers: { ...route.request().headers(), ...cabecalhos } })
      )
    }
    await use(context)
  },
  /** API: o `request` do teste fala só com o `baseURL`, então leva o cabeçalho de bypass. */
  request: async ({ request, playwright }, use) => {
    const cabecalhos = cabecalhosDeBypass(e2eEnv())
    if (!cabecalhos) return use(request)
    const comBypass = await playwright.request.newContext({ extraHTTPHeaders: cabecalhos })
    await use(comBypass)
    await comBypass.dispose()
  },
})

export { expect }
