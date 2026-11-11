import { describe, it, expect } from 'vitest'
import { ForbiddenError, RateLimitedError, AppError, TimeoutError } from '@/shared/errors'

describe('erros funcionais novos', () => {
  it('ForbiddenError → 403 FORBIDDEN', () => {
    const e = new ForbiddenError()
    expect(e).toBeInstanceOf(AppError)
    expect([e.statusCode, e.code, e.message]).toEqual([403, 'FORBIDDEN', 'Acesso negado'])
  })

  it('RateLimitedError → 429 RATE_LIMITED', () => {
    const e = new RateLimitedError()
    expect([e.statusCode, e.code]).toEqual([429, 'RATE_LIMITED'])
  })
})

describe('TimeoutError', () => {
  it('→ 504 TIMEOUT com mensagem genérica (técnico)', () => {
    const e = new TimeoutError()
    expect(e).toBeInstanceOf(AppError)
    expect([e.statusCode, e.code, e.message]).toEqual([
      504,
      'TIMEOUT',
      'A operação demorou demais. Tente novamente.',
    ])
  })
})
