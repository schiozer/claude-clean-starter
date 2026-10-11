// tests/unit/toToolError.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { toToolError } from '@/shared/mcp'
import { ForbiddenError } from '@/shared/errors'

afterEach(() => vi.restoreAllMocks())

describe('toToolError', () => {
  it('ZodError → isError com a mensagem do schema (funcional — não loga)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const parsed = z.object({ title: z.string().min(3, 'Título curto') }).safeParse({ title: 'a' })
    const result = toToolError(parsed.error, 'mcp:create_resource')
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'Título curto' }], _meta: { code: 'VALIDATION_ERROR' } })
    expect(spy).not.toHaveBeenCalled()
  })

  it('AppError → isError com mensagem e code (funcional — não loga)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = toToolError(new ForbiddenError('Permissão ausente: resources:write'), 'mcp:x')
    expect(result._meta).toEqual({ code: 'FORBIDDEN' })
    expect(result.content).toEqual([{ type: 'text', text: 'Permissão ausente: resources:write' }])
    expect(spy).not.toHaveBeenCalled()
  })

  it('erro desconhecido → mensagem genérica, sem detalhe interno, e loga (técnico)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = toToolError(new Error('connection refused 10.0.0.5'), 'mcp:list_resources')
    expect(result.content).toEqual([{ type: 'text', text: 'Falha temporária, tente novamente.' }])
    expect(result._meta).toEqual({ code: 'INTERNAL_ERROR' })
    expect(spy).toHaveBeenCalledWith('[mcp:list_resources]', expect.objectContaining({ message: 'connection refused 10.0.0.5' }))
  })
})
