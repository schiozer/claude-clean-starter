import { describe, it, expect } from 'vitest'
import { handleApiError } from '@/shared/handleApiError'
import { ValidationError } from '@/shared/errors'

describe('handleApiError', () => {
  it('mapeia AppError para status + code', async () => {
    const res = handleApiError(new ValidationError('Título inválido'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Título inválido', code: 'VALIDATION_ERROR' })
  })

  it('mapeia erro desconhecido para 500 genérico', async () => {
    const res = handleApiError(new Error('boom'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' })
  })
})
