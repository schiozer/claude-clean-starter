import { timingSafeEqual } from 'node:crypto'

type Env = Record<string, string | undefined>

export const E2E_DELAY_HEADER = 'x-e2e-delay-ms'
export const E2E_FAULT_HEADER = 'x-e2e-fault'
export const E2E_SECRET_HEADER = 'x-e2e-secret'
export const MAX_E2E_DELAY_MS = 60_000
const MIN_SECRET_LENGTH = 16
/**
 * Únicos `APP_ENV` com falhas injetáveis (allowlist: `production`, `prod` ou um typo ficam
 * fechados). `development` é o valor do Dev local no `.env.example`; `dev`, a forma curta.
 */
const FAULTS_APP_ENVS: ReadonlySet<string> = new Set(['e2e', 'uat', 'dev', 'development'])

/** Mensagem do erro cru injetado (RNF-SEG-004): imita SQL e caminho de código que vazariam. */
export const E2E_FAULT_SENTINEL = 'SELECT * FROM segredo /src/sentinela.ts'

export type E2eFault = 'throw'

function sameSecret(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Portão de toda falha injetada: `APP_ENV` na allowlist (`e2e`, `uat`, `dev`/`development`) **e** `x-e2e-secret`
 * igual a `E2E_FAULTS_SECRET` (≥ 16 caracteres). Fora disso, os headers são inertes.
 */
function faultsAuthorized(req: Request, env: Env): boolean {
  if (!FAULTS_APP_ENVS.has(env.APP_ENV ?? '')) return false
  const secret = env.E2E_FAULTS_SECRET ?? ''
  const received = req.headers.get(E2E_SECRET_HEADER)
  return secret.length >= MIN_SECRET_LENGTH && !!received && sameSecret(secret, received)
}

/** Atraso de teste pedido pelo header `x-e2e-delay-ms` (RNF-TMO-001), atrás do portão. Limitado a 60 s. */
export function e2eDelayMs(req: Request, env: Env = process.env): number {
  if (!faultsAuthorized(req, env)) return 0
  const raw = req.headers.get(E2E_DELAY_HEADER)
  if (!raw || !/^\d+$/.test(raw)) return 0
  return Math.min(Number(raw), MAX_E2E_DELAY_MS)
}

/**
 * Falha de teste pedida pelo header `x-e2e-fault` (RNF-SEG-004), atrás do mesmo portão. `throw` →
 * a rota lança um `Error` cru com `E2E_FAULT_SENTINEL`, que precisa sair genérico pelo `handleApiError`.
 */
export function e2eFault(req: Request, env: Env = process.env): E2eFault | null {
  if (!faultsAuthorized(req, env)) return null
  return req.headers.get(E2E_FAULT_HEADER) === 'throw' ? 'throw' : null
}
