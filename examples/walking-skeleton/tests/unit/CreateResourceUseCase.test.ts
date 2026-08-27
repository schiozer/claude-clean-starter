import { describe, it, expect, vi } from 'vitest'
import { CreateResourceUseCase } from '@/application/use-cases/CreateResourceUseCase'
import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'

function mockRepo(): IResourceRepository {
  return {
    findById: vi.fn(),
    findByOwnerId: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(),
  }
}

describe('CreateResourceUseCase', () => {
  it('cria e salva o resource', async () => {
    const repo = mockRepo()
    const useCase = new CreateResourceUseCase(repo)
    const result = await useCase.execute({ title: 'Novo' }, 'owner-1')
    expect(result.title).toBe('Novo')
    expect(result.ownerId).toBe('owner-1')
    expect(repo.save).toHaveBeenCalledTimes(1)
  })

  it('propaga erro de domínio para título inválido', async () => {
    const repo = mockRepo()
    const useCase = new CreateResourceUseCase(repo)
    await expect(useCase.execute({ title: 'ab' }, 'owner-1')).rejects.toThrow()
    expect(repo.save).not.toHaveBeenCalled()
  })
})
