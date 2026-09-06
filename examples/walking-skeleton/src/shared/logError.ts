import { AppError } from './errors'

/**
 * Sink central de log de erros — o ÚNICO ponto do app autorizado a chamar
 * `console`. A regra ESLint `no-console: 'error'` proíbe `console.*` em `src/**`;
 * a exceção é a linha abaixo, marcada com `eslint-disable-next-line`.
 *
 * `context` identifica a origem no formato `'<área>:<handler>'`
 * (ex.: `'api/resources:POST'`). Aqui é onde, num projeto real, se pluga
 * Sentry/observabilidade.
 */
export function logError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const err = error instanceof Error ? error : new Error(String(error))
  // eslint-disable-next-line no-console -- sink central de log; ver doc acima
  console.error(`[${context}]`, {
    name: err.name,
    message: err.message,
    code: err instanceof AppError ? err.code : undefined,
    ...extra,
  })
}
