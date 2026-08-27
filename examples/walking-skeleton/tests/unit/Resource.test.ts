import { describe, it, expect } from 'vitest'
import { Resource } from '@/domain/entities/Resource'
import { DomainError } from '@/shared/errors'

describe('Resource', () => {
  it('cria com título válido', () => {
    const r = new Resource('id-1', 'Meu título', 'owner-1', new Date())
    expect(r.title).toBe('Meu título')
  })
  it('rejeita título curto (< 3)', () => {
    expect(() => new Resource('id-1', 'ab', 'owner-1', new Date())).toThrow(DomainError)
  })
  it('rejeita título longo (> 100)', () => {
    expect(() => new Resource('id-1', 'x'.repeat(101), 'owner-1', new Date())).toThrow(DomainError)
  })
})
