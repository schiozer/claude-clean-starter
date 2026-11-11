import { timingSafeEqual } from 'node:crypto'

type Env = Record<string, string | undefined>

export const E2E_DELAY_HEADER = 'x-e2e-delay-ms'
export const E2E_SECRET_HEADER = 'x-e2e-secret'
export const MAX_E2E_DELAY_MS = 60_000
const MIN_SECRET_LENGTH = 16

function sameSecret(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Atraso de teste pedido pelo header `x-e2e-delay-ms` (RNF-TMO-001). Inerte (0, sem efeito nem
 * mensagem) salvo com `APP_ENV` declarado e diferente de `production` **e** `x-e2e-secret` igual a
 * `E2E_FAULTS_SECRET` (≥ 16 caracteres). Limitado a 60 s.
 */
export function e2eDelayMs(req: Request, env: Env = process.env): number {
  if (!env.APP_ENV || env.APP_ENV === 'production') return 0
  const secret = env.E2E_FAULTS_SECRET ?? ''
  const received = req.headers.get(E2E_SECRET_HEADER)
  if (secret.length < MIN_SECRET_LENGTH || !received || !sameSecret(secret, received)) return 0
  const raw = req.headers.get(E2E_DELAY_HEADER)
  if (!raw || !/^\d+$/.test(raw)) return 0
  return Math.min(Number(raw), MAX_E2E_DELAY_MS)
}
