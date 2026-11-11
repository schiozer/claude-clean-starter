// Login dos perfis de teste (spec e2e-regressao-docs §7.2). Usado pelo projeto `setup`
// (`tests/e2e/auth.setup.ts`), que salva o `storageState` de cada perfil em `perfis`.
import { expect, test, type Page } from '@playwright/test'
import { e2eEnv } from './env'

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

const CREDENCIAIS: Record<Perfil, { email: string; senha: string }> = {
  usuario: { email: 'E2E_USUARIO_EMAIL', senha: 'E2E_USUARIO_SENHA' },
  interno: { email: 'E2E_INTERNO_EMAIL', senha: 'E2E_INTERNO_SENHA' },
}

/** Credencial do usuário de teste do perfil no Auth0; falta → erro com o nome das variáveis. */
export const credencialAuth0 = (perfil: Perfil): { email: string; senha: string } => {
  const nomes = CREDENCIAIS[perfil]
  const email = process.env[nomes.email]?.trim()
  const senha = process.env[nomes.senha]
  if (!email || !senha) {
    throw new Error(
      `E2E_AUTH=auth0 exige ${nomes.email} e ${nomes.senha} (segredos do GitHub; runbook e2e-uat-configurar)`
    )
  }
  return { email, senha }
}

/** Login do perfil pelo modo da execução (`E2E_AUTH`): stub local ou Universal Login. */
export const entrar = async (page: Page, perfil: Perfil): Promise<void> => {
  if (e2eEnv().auth === 'auth0') await loginAuth0(page, credencialAuth0(perfil))
  else await loginDev(page, perfil)
}
