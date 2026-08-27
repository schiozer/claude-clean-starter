import type { Resource } from '@/domain/entities/Resource'
import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'

export class ListResourcesUseCase {
  constructor(private readonly repository: IResourceRepository) {}

  async execute(ownerId: string): Promise<Resource[]> {
    return this.repository.findByOwnerId(ownerId)
  }
}
