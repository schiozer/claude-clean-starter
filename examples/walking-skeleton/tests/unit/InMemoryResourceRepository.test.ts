import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryResourceRepository } from '@/infrastructure/repositories/InMemoryResourceRepository'
import { Resource } from '@/domain/entities/Resource'

describe('InMemoryResourceRepository', () => {
  let repo: InMemoryResourceRepository
  beforeEach(() => {
    repo = new InMemoryResourceRepository()
  })

  it('save + findByOwnerId retorna só do dono', async () => {
    await repo.save(new Resource('1', 'AAA', 'owner-1', new Date()))
    await repo.save(new Resource('2', 'BBB', 'owner-2', new Date()))
    const mine = await repo.findByOwnerId('owner-1')
    expect(mine.map((r) => r.id)).toEqual(['1'])
  })

  it('findById retorna null quando não existe', async () => {
    expect(await repo.findById('nope')).toBeNull()
  })
})
