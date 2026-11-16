// `test` e `expect` da suíte E2E: os do Playwright mais os cabeçalhos de acesso do host (bypass da
// Vercel; heroku/cloudrun não têm) restritos à origem do preview (spec e2e-regressao-docs §8.2;
// R24). Testes importam `test`/`expect` de `support`, não de `@playwright/test`. No modo local
// (ou sem cabeçalhos para o host) nada muda.
import { test as base, expect } from '@playwright/test'
import { cabecalhosDeAcesso, e2eEnv, origemDoAlvo } from './env'

export const test = base.extend({
  /**
   * Navegador: os cabeçalhos de bypass entram só nas requisições à origem do `baseURL`. Auth0, CDN
   * e terceiros não recebem o segredo (nem pagam preflight de CORS). A 1ª resposta grava o cookie
   * de bypass, que cobre também o `page.request` do contexto.
   */
  context: async ({ context, baseURL }, use) => {
    const cabecalhos = cabecalhosDeAcesso(e2eEnv())
    if (cabecalhos && baseURL) {
      await context.route(origemDoAlvo(baseURL), (route) =>
        route.fallback({ headers: { ...route.request().headers(), ...cabecalhos } })
      )
    }
    await use(context)
  },
  /** API: o `request` do teste fala só com o `baseURL`, então leva o cabeçalho de bypass. */
  request: async ({ request, playwright }, use) => {
    const cabecalhos = cabecalhosDeAcesso(e2eEnv())
    if (!cabecalhos) return use(request)
    const comBypass = await playwright.request.newContext({ extraHTTPHeaders: cabecalhos })
    await use(comBypass)
    await comBypass.dispose()
  },
})

export { expect }
