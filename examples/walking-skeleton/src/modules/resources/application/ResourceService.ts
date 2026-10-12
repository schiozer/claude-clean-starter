import { requireScope, type AuthUser } from '@/shared/auth'
import type { Clock } from '@/shared/kernel'
import type { IResourceRepository } from '../domain/IResourceRepository'
import { Resource } from '../domain/Resource'
import { Title } from '../domain/Title'
import { toResourceDTO, type ResourceDTO } from './dto'
import type { CreateResourceInput, ListResourcesInput } from './schemas'

export class ResourceService {
  constructor(
    private readonly repo: IResourceRepository,
    private readonly clock: Clock
  ) {}

  async list(actor: AuthUser, input: ListResourcesInput): Promise<ResourceDTO[]> {
    requireScope(actor, 'resources:read')
    const items = await this.repo.findByOwner(actor.tenantId, actor.id, input)
    return items.map(toResourceDTO)
  }

  async create(actor: AuthUser, input: CreateResourceInput): Promise<ResourceDTO> {
    requireScope(actor, 'resources:write')
    const resource = Resource.create(
      { tenantId: actor.tenantId, ownerId: actor.id, title: Title.of(input.title) },
      this.clock
    )
    await this.repo.save(resource)
    return toResourceDTO(resource)
  }
}
