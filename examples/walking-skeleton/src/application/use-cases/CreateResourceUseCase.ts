import { Resource } from '@/domain/entities/Resource'
import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'
import type { CreateResourceDTO } from '@/application/validators/resourceSchemas'

export class CreateResourceUseCase {
  constructor(private readonly repository: IResourceRepository) {}

  async execute(dto: CreateResourceDTO, ownerId: string): Promise<Resource> {
    const resource = new Resource(crypto.randomUUID(), dto.title, ownerId, new Date())
    await this.repository.save(resource)
    return resource
  }
}
