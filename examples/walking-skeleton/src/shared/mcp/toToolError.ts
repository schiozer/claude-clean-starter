import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ZodError } from 'zod'
import { AppError } from '@/shared/errors'
import { logError } from '@/shared/logError'

export function toolError(message: string, code: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }], _meta: { code } }
}

/** Fronteira de erro da borda MCP (ADR-009): funcional acionável; técnico genérico + log. */
export function toToolError(error: unknown, context: string): CallToolResult {
  if (error instanceof ZodError) {
    return toolError(error.issues[0]?.message ?? 'Dados inválidos', 'VALIDATION_ERROR')
  }
  if (error instanceof AppError) return toolError(error.message, error.code)
  logError(context, error)
  return toolError('Falha temporária, tente novamente.', 'INTERNAL_ERROR')
}
