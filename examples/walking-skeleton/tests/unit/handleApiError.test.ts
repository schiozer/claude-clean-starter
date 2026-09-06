import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleApiError } from '@/shared/handleApiError'
import { ValidationError } from '@/shared/errors'

afterEach(() => vi.restoreAllMocks())

describe('handleApiError', () => {
  it('mapeia AppError para status + code (funcional — não loga)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = handleApiError(new ValidationError('Título inválido'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Título inválido', code: 'VALIDATION_ERROR' })
    // erro funcional não é bug → não passa pelo sink
    expect(spy).not.toHaveBeenCalled()
  })

  it('mapeia erro desconhecido para 500 genérico e loga no sink (técnico)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = handleApiError(new Error('boom'), 'api/resources:POST')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' })
    // erro técnico (inesperado) → vai para o sink central, com o contexto
    expect(spy).toHaveBeenCalledWith('[api/resources:POST]', expect.objectContaining({ message: 'boom' }))
  })
})
