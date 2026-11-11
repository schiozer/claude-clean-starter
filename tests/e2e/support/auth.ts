// Login dos perfis de teste (spec e2e-regressao-docs §7.2). Usado pelo projeto `setup`
// (`tests/e2e/auth.setup.ts`), que salva o `storageState` de cada perfil em `perfis`.
import { expect, test, type Page } from '@playwright/test'

export type Perfil = 'usuario' | 'interno'

/** Arquivos de `storageState` por perfil (ignorados pelo git). */
export const perfis = {
  usuario: 'playwright/.auth/usuario.json',
  interno: 'playwright/.auth/interno.json',
} as const satisfies Record<Perfil, string>

/** Modo local (`APP_ENV=e2e`): login stub do app, sem IdP. */
export const loginDev = async (page: Page, perfil: Perfil): Promise<void> => {
  await page.goto(`/dev-login?perfil=${perfil}&next=/`)
  await expect(page).not.toHaveURL(/\/dev-login/)
}

/** Rota do app que inicia o login no Auth0 (padrão do `@auth0/nextjs-auth0` v4). */
export const AUTH0_LOGIN_PATH = '/auth/login?returnTo=/'

/** UAT: Universal Login do Auth0 com o usuário de teste do perfil; volta ao app logado. */
export const loginAuth0 = async (
  page: Page,
  cred: { email: string; senha: string }
): Promise<void> => {
  const base = test.info().project.use.baseURL
  if (!base) throw new Error('loginAuth0: baseURL do projeto não definido')
  const origem = new URL(base).origin
  await page.goto(AUTH0_LOGIN_PATH)
  await page.locator('input[name=username]').fill(cred.email)
  await page.locator('input[name=password]').fill(cred.senha)
  await page.locator('button[type=submit][name=action]').click()
  await page.waitForURL((url) => url.origin === origem)
}
