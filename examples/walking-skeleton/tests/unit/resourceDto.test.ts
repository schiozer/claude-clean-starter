import { describe, it, expect } from 'vitest'
import { toResourceDTO, toResourcePage, resourceDTOSchema } from '@/modules/resources'
import { Resource } from '@/modules/resources/domain/Resource'
import { Title } from '@/modules/resources/domain/Title'
import { fixedClock } from '../helpers/fixedClock'

const make = (title: string) =>
  toResourceDTO(Resource.create({ tenantId: 't1', ownerId: 'ana', title: Title.of(title) }, fixedClock))

describe('toResourceDTO', () => {
  it('expõe só id, title, ownerId e createdAt ISO (sem tenantId)', () => {
    const dto = make('Novo')
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'id', 'ownerId', 'title'])
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(resourceDTOSchema.parse(dto)).toEqual(dto)
  })
})

describe('toResourcePage', () => {
  it('página cheia → nextCursor = id do último', () => {
    const items = [make('Um1'), make('Dois')]
    expect(toResourcePage(items, 2).nextCursor).toBe(items[1].id)
  })
  it('página incompleta → nextCursor null', () => {
    expect(toResourcePage([make('Um1')], 2).nextCursor).toBeNull()
  })
})
