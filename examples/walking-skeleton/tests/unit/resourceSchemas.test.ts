import { describe, it, expect } from 'vitest'
import { createResourceSchema, listResourcesSchema } from '@/modules/resources'

describe('createResourceSchema', () => {
  it('aceita título válido e faz trim', () => {
    expect(createResourceSchema.parse({ title: '  Válido  ' })).toEqual({ title: 'Válido' })
  })
  it('rejeita título curto com a mensagem do domínio', () => {
    const r = createResourceSchema.safeParse({ title: 'ab' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Título deve ter de 3 a 100 caracteres')
  })
  it('descarta campos extras como ownerId', () => {
    expect(createResourceSchema.parse({ title: 'Válido', ownerId: 'bia' })).toEqual({ title: 'Válido' })
  })
})

describe('listResourcesSchema', () => {
  it('usa limit 20 por padrão', () => {
    expect(listResourcesSchema.parse({})).toEqual({ limit: 20 })
  })
  it('limita a página a 50 itens', () => {
    expect(listResourcesSchema.safeParse({ limit: 51 }).success).toBe(false)
  })
  it('rejeita limit não inteiro ou menor que 1', () => {
    expect(listResourcesSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(listResourcesSchema.safeParse({ limit: 1.5 }).success).toBe(false)
  })
})
