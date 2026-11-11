// Variáveis de ambiente da suíte E2E num só lugar (spec e2e-regressao-docs §7.2 e §8).
// Puro: sem Playwright, testável no Vitest (`tests/unit/e2eEnv.test.ts`).

export type Env = Record<string, string | undefined>

export interface E2eEnv {
  /** Alvo remoto (Preview da Vercel); `null` = sobe o app local pelo `webServer`. */
  baseUrl: string | null
  /** Como o `setup` autentica: `dev` (`/dev-login`, só no modo local) ou `auth0` (Universal Login). */
  auth: 'dev' | 'auth0'
  /** `VERCEL_AUTOMATION_BYPASS_SECRET`: passa pela Deployment Protection do Preview. */
  bypass: string | null
  /** `E2E_FAULTS_SECRET`: habilita a injeção de lentidão (`x-e2e-delay-ms`) fora de Prod. */
  faultsSecret: string | null
  /** `E2E_RUN_PREFIX`: sufixo dos dados gravados por esta execução (ver `dado()`). */
  runPrefix: string
  /**
   * PATs dos usuários de teste (`E2E_PAT_USUARIO`, `E2E_PAT_SEM_ESCOPO`, `E2E_PAT_RATE_LIMIT`):
   * semear dados pela API/MCP, testar o 403 sem escopo e o rate limit sem afetar os demais.
   */
  pat: { usuario: string | null; semEscopo: string | null; rateLimit: string | null }
}

const texto = (valor: string | undefined): string | null => {
  const limpo = valor?.trim() ?? ''
  return limpo === '' ? null : limpo
}

export const e2eEnv = (env: Env = process.env): E2eEnv => ({
  baseUrl: texto(env.E2E_BASE_URL),
  auth: env.E2E_AUTH?.trim() === 'auth0' ? 'auth0' : 'dev',
  bypass: texto(env.VERCEL_AUTOMATION_BYPASS_SECRET),
  faultsSecret: texto(env.E2E_FAULTS_SECRET),
  runPrefix: env.E2E_RUN_PREFIX?.trim() ?? '',
  pat: {
    usuario: texto(env.E2E_PAT_USUARIO),
    semEscopo: texto(env.E2E_PAT_SEM_ESCOPO),
    rateLimit: texto(env.E2E_PAT_RATE_LIMIT),
  },
})
