import { describe, it, expect, vi } from 'vitest'
import { ListResourcesUseCase } from '@/application/use-cases/ListResourcesUseCase'
import { Resource } from '@/domain/entities/Resource'
import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'

describe('ListResourcesUseCase', () => {
  it('retorna os resources do owner', async () => {
    const mine = [new Resource('1', 'Meu', 'owner-1', new Date())]
    const repo: IResourceRepository = {
      findById: vi.fn(),
      findByOwnerId: vi.fn().mockResolvedValue(mine),
      save: vi.fn(),
      delete: vi.fn(),
    }
    const useCase = new ListResourcesUseCase(repo)
    const result = await useCase.execute('owner-1')
    expect(result).toEqual(mine)
    expect(repo.findByOwnerId).toHaveBeenCalledWith('owner-1')
  })
})
