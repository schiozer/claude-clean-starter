import { describe, it, expect } from 'vitest'
import { Title } from '@/modules/resources/domain/Title'
import { DomainError } from '@/shared/errors'

describe('Title', () => {
  it('rejeita título com menos de 3 caracteres', () => {
    expect(() => Title.of('ab')).toThrow(DomainError)
  })
  it('rejeita título com mais de 100 caracteres', () => {
    expect(() => Title.of('x'.repeat(101))).toThrow('Título deve ter de 3 a 100 caracteres')
  })
  it('conta o tamanho depois do trim', () => {
    expect(() => Title.of('  ab  ')).toThrow(DomainError)
  })
  it('normaliza espaços nas pontas', () => {
    expect(Title.of('  Meu recurso  ').value).toBe('Meu recurso')
  })
})
