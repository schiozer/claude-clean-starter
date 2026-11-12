// Projeto `setup` do Playwright: autentica uma vez por execução cada perfil de teste e salva o
// `storageState` em `perfis.*` (spec e2e-regressao-docs §7.2). Do projeto: ajuste ao seu login.
import { entrar, perfis, type Perfil, test as setup } from './support'

for (const perfil of Object.keys(perfis) as Perfil[]) {
  setup(`autentica o perfil ${perfil}`, async ({ page }) => {
    await entrar(page, perfil)
    await page.context().storageState({ path: perfis[perfil] })
  })
}
