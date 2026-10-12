import { describe, it, expect } from 'vitest'
import { Resource } from '@/modules/resources/domain/Resource'
import { ResourceId } from '@/modules/resources/domain/ResourceId'
import { Title } from '@/modules/resources/domain/Title'
import { DomainError } from '@/shared/errors'
import { fixedClock } from '../helpers/fixedClock'

describe('Resource', () => {
  it('create gera id UUID e usa o relógio injetado', () => {
    const r = Resource.create({ tenantId: 't1', ownerId: 'ana', title: Title.of('Novo') }, fixedClock)
    expect(r.id.value).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(r.title.value).toBe('Novo')
  })

  it('rehydrate ∘ toSnapshot preserva os dados', () => {
    const r = Resource.create({ tenantId: 't1', ownerId: 'ana', title: Title.of('Novo') }, fixedClock)
    expect(Resource.rehydrate(r.toSnapshot()).toSnapshot()).toEqual(r.toSnapshot())
  })

  it('rehydrate revalida as invariantes (título inválido no banco → DomainError)', () => {
    const snap = { ...Resource.create({ tenantId: 't1', ownerId: 'ana', title: Title.of('Novo') }, fixedClock).toSnapshot(), title: 'x' }
    expect(() => Resource.rehydrate(snap)).toThrow(DomainError)
  })

  it('ResourceId.of rejeita valor que não é UUID', () => {
    expect(() => ResourceId.of('nao-uuid')).toThrow(DomainError)
  })
})
