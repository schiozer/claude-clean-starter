import { AppError } from './errors'

export function handleApiError(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode })
  }
  return Response.json(
    { error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' },
    { status: 500 }
  )
}
