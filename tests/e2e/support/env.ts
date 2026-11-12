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
   * PATs dos usuários de teste (`E2E_PAT_USUARIO`, `E2E_PAT_SEM_ESCOPO`, `E2E_PAT_RATE_LIMIT`,
   * `E2E_PAT_OUTRO_ATOR`): semear dados pela API/MCP, testar o 403 sem escopo, o rate limit sem
   * afetar os demais e o isolamento entre atores (um 2º ator que lê, sem os dados do usuário).
   */
  pat: {
    usuario: string | null
    semEscopo: string | null
    rateLimit: string | null
    outroAtor: string | null
  }
}

const texto = (valor: string | undefined): string | null => {
  const limpo = valor?.trim() ?? ''
  return limpo === '' ? null : limpo
}

/** `E2E_AUTH`: vazio ou `dev` → login stub; `auth0` → Universal Login; outro valor → erro. */
const modoDeAuth = (valor: string | undefined): E2eEnv['auth'] => {
  const modo = valor?.trim() ?? ''
  if (modo === '' || modo === 'dev') return 'dev'
  if (modo === 'auth0') return 'auth0'
  throw new Error(`E2E_AUTH='${modo}' inválido: use 'dev' (ou vazio) ou 'auth0'`)
}

/** `docs:gerar` captura telas com os dados do alvo: contra um ambiente remoto, recusa cedo. */
const alvo = (env: Env): string | null => {
  const baseUrl = texto(env.E2E_BASE_URL)
  if (baseUrl && env.E2E_DOCS === '1') {
    throw new Error(
      'docs:gerar só roda local: remova E2E_BASE_URL (as capturas sairiam com os dados do ambiente remoto)'
    )
  }
  return baseUrl
}

export const e2eEnv = (env: Env = process.env): E2eEnv => ({
  baseUrl: alvo(env),
  auth: modoDeAuth(env.E2E_AUTH),
  bypass: texto(env.VERCEL_AUTOMATION_BYPASS_SECRET),
  faultsSecret: texto(env.E2E_FAULTS_SECRET),
  runPrefix: env.E2E_RUN_PREFIX?.trim() ?? '',
  pat: {
    usuario: texto(env.E2E_PAT_USUARIO),
    semEscopo: texto(env.E2E_PAT_SEM_ESCOPO),
    rateLimit: texto(env.E2E_PAT_RATE_LIMIT),
    outroAtor: texto(env.E2E_PAT_OUTRO_ATOR),
  },
})

/**
 * Cabeçalhos da Deployment Protection da Vercel (`x-vercel-protection-bypass` + cookie de bypass),
 * ou `null` sem segredo (modo local). Vão **só** para a origem do preview (ver `support/test.ts`),
 * nunca para Auth0, CDN ou terceiros.
 */
export const cabecalhosDeBypass = (env: E2eEnv): Record<string, string> | null =>
  env.bypass
    ? { 'x-vercel-protection-bypass': env.bypass, 'x-vercel-set-bypass-cookie': 'true' }
    : null

/** Predicado de URL: `true` só para a origem exata (esquema, host e porta) do `baseURL`. */
export const origemDoAlvo =
  (baseUrl: string) =>
  (url: URL): boolean =>
    url.origin === new URL(baseUrl).origin
