// Baseline de sessão (docs/rnf.md, RNF-SES-*): prazo de inatividade do cookie, sessão inválida que
// volta à origem após o login e logout que invalida no servidor. Roda no projeto `sistemico`.
import { expect, test, type Page } from '@playwright/test'
import {
  credencialAuth0,
  e2eEnv,
  entrar,
  parametro,
  perfis,
  rnfMs,
  telasExigidas,
} from '../support'

const cookieDeSessao = <C extends { name: string }>(cookies: C[]): C => {
  const nome = parametro('cookieDeSessao')
  const cookie = cookies.find((c) => c.name === nome)
  if (!cookie) throw new Error(`cookie de sessão '${nome}' ausente`)
  return cookie
}

/** Já na tela de login (vinda do redirecionamento): conclui o login do usuário final. */
const concluirLogin = async (page: Page): Promise<void> => {
  if (e2eEnv().auth === 'auth0') {
    const { email, senha } = credencialAuth0('usuario')
    await page.locator('input[name=username]').fill(email)
    await page.locator('input[name=password]').fill(senha)
    await page.locator('button[type=submit][name=action]').click()
    return
  }
  const url = new URL(page.url())
  url.searchParams.set('perfil', 'usuario')
  await page.goto(url.toString())
}

test.describe('com sessão do usuário', () => {
  test.use({ storageState: perfis.usuario })

  test(
    'RNF-SES-001 sessão expira pela inatividade do baseline',
    { tag: ['@rnf', '@regressao'] },
    async ({ request }) => {
      // Visitar uma tela renova a inatividade: o prazo do cookie conta a partir de agora.
      expect((await request.get(telasExigidas()[0]?.rota ?? '/')).status()).toBe(200)
      const cookie = cookieDeSessao((await request.storageState()).cookies)
      const restanteMs = cookie.expires * 1000 - Date.now()
      expect(cookie.expires, 'cookie persistente (com Max-Age/Expires)').toBeGreaterThan(0)
      const inatividadeMs = rnfMs('RNF-SES-001')
      expect(restanteMs, 'expira em ≥ inatividade − 60 s').toBeGreaterThanOrEqual(
        inatividadeMs - 60_000
      )
      expect(restanteMs, 'expira em ≤ inatividade + 60 s').toBeLessThanOrEqual(
        inatividadeMs + 60_000
      )
    }
  )
})

test(
  'RNF-SES-002 sessão inválida vai ao login e volta à origem',
  { tag: ['@rnf', '@regressao'] },
  async ({ page, baseURL }) => {
    const origem = parametro('telaComApi')
    await page
      .context()
      .addCookies([
        { name: parametro('cookieDeSessao'), value: 'sessao-invalida', url: baseURL ?? '' },
      ])

    await page.goto(origem)
    const login = new URL(page.url())
    expect(login.pathname, 'redireciona ao login').toBe(parametro('rotaDeLogin'))
    expect(login.searchParams.get('next'), 'guarda a origem').toBe(origem)

    await concluirLogin(page)
    await expect(page).toHaveURL((url) => url.pathname === origem)
  }
)

test(
  'RNF-SES-003 logout invalida a sessão no servidor',
  { tag: ['@rnf', '@regressao'] },
  async ({ page }) => {
    // Sessão própria: revogar a do storageState derrubaria os outros testes.
    await entrar(page, 'usuario')
    const contexto = page.context()
    const antiga = cookieDeSessao(await contexto.cookies())
    const rota = parametro('rotaProtegida')
    expect((await page.request.get(rota)).status(), 'sessão nova funciona').toBe(200)

    const logout = await page.request.post(parametro('rotaDeLogout'))
    expect(logout.ok(), `logout: HTTP ${logout.status()}`).toBe(true)

    await contexto.clearCookies()
    await contexto.addCookies([antiga])
    expect((await page.request.get(rota)).status(), 'cookie antigo reaproveitado').toBe(401)
  }
)
