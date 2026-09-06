import { ZodError } from 'zod'
import { AppError } from './errors'
import { logError } from './logError'

export function handleApiError(error: unknown, context = 'api'): Response {
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? 'Dados inválidos'
    return Response.json({ error: message, code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  if (error instanceof AppError) {
    // Erro de domínio (funcional) é esperado — não é bug, não vai para o sink.
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode })
  }
  // Só o inesperado (técnico → 500) passa pelo sink central de log.
  logError(context, error)
  return Response.json(
    { error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' },
    { status: 500 }
  )
}
