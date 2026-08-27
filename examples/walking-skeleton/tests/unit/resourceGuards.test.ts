import { describe, it, expect } from 'vitest'
import { requireUser, assertOwnership } from '@/application/authz/resourceGuards'
import { UnauthorizedError } from '@/shared/errors'

describe('resourceGuards', () => {
  it('requireUser lança 401 sem usuário', () => {
    expect(() => requireUser(null)).toThrow(UnauthorizedError)
  })
  it('requireUser retorna o usuário quando presente', () => {
    expect(requireUser({ id: 'u1' })).toEqual({ id: 'u1' })
  })
  it('assertOwnership nega dono diferente', () => {
    expect(() => assertOwnership({ id: 'u1' }, 'u2')).toThrow(UnauthorizedError)
  })
  it('assertOwnership permite o próprio dono', () => {
    expect(() => assertOwnership({ id: 'u1' }, 'u1')).not.toThrow()
  })
})
