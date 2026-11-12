// Playwright do projeto (spec e2e-regressao-docs §7.3). Alvo: `E2E_BASE_URL` (Preview da Vercel)
// ou, sem ele, o app local subido pelo `webServer`. Arquivo do projeto: ajuste o `webServer` à sua
// app; os testes vêm dos globs `testes` de `tests/e2e/cenarios.config.json`.
import { readFileSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { e2eEnv, perfis } from './tests/e2e/support'

const env = e2eEnv()
const CI = Boolean(process.env.CI)
/** `docs:gerar` sempre sobe um app novo: banco em memória limpo, capturas sem dados de outra execução. */
const DOCS = process.env.E2E_DOCS === '1'
const PORTA_LOCAL = 3100

/**
 * Valores fixos **só para o app local** do `webServer` (APP_ENV=e2e, nunca um deploy). Não são
 * segredos: ficam versionados para que a suíte e o app local combinem. Em UAT os valores reais vêm
 * dos segredos do GitHub/Vercel (runbook e2e-uat-configurar).
 */
const LOCAL_SOMENTE_TESTE = {
  E2E_SESSION_SECRET: 'e2e-local-session-secret-0000000000',
  E2E_FAULTS_SECRET: 'e2e-local-faults-secret-00000000',
  DEV_PERSONAL_TOKEN: 'pat_e2e_local_dev_token_000000000000',
  E2E_PAT_SEM_ESCOPO: 'pat_e2e_local_sem_escopo_0000000000',
  E2E_PAT_RATE_LIMIT: 'pat_e2e_local_rate_limit_0000000000',
  E2E_PAT_OUTRO_ATOR: 'pat_e2e_local_outro_ator_0000000000',
}

// No modo local os testes precisam do mesmo segredo de falhas e dos mesmos PATs que o app local
// recebe.
if (!env.baseUrl) {
  process.env.E2E_FAULTS_SECRET ||= LOCAL_SOMENTE_TESTE.E2E_FAULTS_SECRET
  process.env.E2E_PAT_USUARIO ||= LOCAL_SOMENTE_TESTE.DEV_PERSONAL_TOKEN
  process.env.E2E_PAT_SEM_ESCOPO ||= LOCAL_SOMENTE_TESTE.E2E_PAT_SEM_ESCOPO
  process.env.E2E_PAT_RATE_LIMIT ||= LOCAL_SOMENTE_TESTE.E2E_PAT_RATE_LIMIT
  process.env.E2E_PAT_OUTRO_ATOR ||= LOCAL_SOMENTE_TESTE.E2E_PAT_OUTRO_ATOR
}

const { testes } = JSON.parse(
  readFileSync(new URL('./tests/e2e/cenarios.config.json', import.meta.url), 'utf8')
) as {
  testes: string[]
}

const NAVEGADOR = /@e2e|@usabilidade/

export default defineConfig({
  testDir: '.',
  testMatch: testes,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  failOnFlakyTests: CI,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: env.baseUrl ?? `http://localhost:${PORTA_LOCAL}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    // Bypass da Vercel (modo preview): não vai em `extraHTTPHeaders`, que o mandaria a toda origem
    // (Auth0, CDN, terceiros). O `test` de `tests/e2e/support` o põe só nas requisições ao `baseURL`.
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { browserName: 'chromium' } },
    // `@rnf` com sessão ou navegador usa `test.use({ storageState: perfis.usuario, ... })`.
    { name: 'sistemico', grep: /@sistemico|@rnf/, dependencies: ['setup'] },
    {
      name: 'desktop',
      grep: NAVEGADOR,
      dependencies: ['setup'],
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        storageState: perfis.usuario,
      },
    },
    {
      name: 'mobile',
      grep: NAVEGADOR,
      dependencies: ['setup'],
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        storageState: perfis.usuario,
      },
    },
  ],
  webServer: env.baseUrl
    ? undefined
    : {
        command: `npm --prefix examples/walking-skeleton run build && npm --prefix examples/walking-skeleton run start -- -p ${PORTA_LOCAL}`,
        url: `http://localhost:${PORTA_LOCAL}`,
        env: {
          APP_ENV: 'e2e',
          RESOURCES_ENABLED: 'on',
          MCP_RESOURCE_URL: `http://localhost:${PORTA_LOCAL}/api/mcp`,
          ...LOCAL_SOMENTE_TESTE,
          E2E_FAULTS_SECRET: process.env.E2E_FAULTS_SECRET ?? LOCAL_SOMENTE_TESTE.E2E_FAULTS_SECRET,
        },
        reuseExistingServer: !CI && !DOCS,
        timeout: 180_000,
      },
})
