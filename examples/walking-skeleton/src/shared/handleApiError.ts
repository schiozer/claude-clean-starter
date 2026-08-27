import { ZodError } from 'zod'
import { AppError } from './errors'

export function handleApiError(error: unknown): Response {
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? 'Dados inválidos'
    return Response.json({ error: message, code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  if (error instanceof AppError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode })
  }
  return Response.json(
    { error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' },
    { status: 500 }
  )
}
