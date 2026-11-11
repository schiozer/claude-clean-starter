// Projeto `setup` do Playwright: autentica uma vez por execução cada perfil de teste e salva o
// `storageState` em `perfis.*` (spec e2e-regressao-docs §7.2). Do projeto: ajuste ao seu login.
import { test as setup } from '@playwright/test'
import { e2eEnv, loginAuth0, loginDev, perfis, type Perfil } from './support'

const CREDENCIAIS: Record<Perfil, { email: string; senha: string }> = {
  usuario: { email: 'E2E_USUARIO_EMAIL', senha: 'E2E_USUARIO_SENHA' },
  interno: { email: 'E2E_INTERNO_EMAIL', senha: 'E2E_INTERNO_SENHA' },
}

const credencial = (perfil: Perfil): { email: string; senha: string } => {
  const nomes = CREDENCIAIS[perfil]
  const email = process.env[nomes.email]?.trim()
  const senha = process.env[nomes.senha]
  if (!email || !senha) {
    throw new Error(
      `auth.setup: E2E_AUTH=auth0 exige ${nomes.email} e ${nomes.senha} (segredos do GitHub; runbook e2e-uat-configurar)`
    )
  }
  return { email, senha }
}

for (const perfil of Object.keys(perfis) as Perfil[]) {
  setup(`autentica o perfil ${perfil}`, async ({ page }) => {
    if (e2eEnv().auth === 'auth0') await loginAuth0(page, credencial(perfil))
    else await loginDev(page, perfil)
    await page.context().storageState({ path: perfis[perfil] })
  })
}
