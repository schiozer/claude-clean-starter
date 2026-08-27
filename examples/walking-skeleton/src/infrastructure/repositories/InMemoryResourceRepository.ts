import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'
import type { Resource } from '@/domain/entities/Resource'

export class InMemoryResourceRepository implements IResourceRepository {
  private store = new Map<string, Resource>()

  async findById(id: string): Promise<Resource | null> {
    return this.store.get(id) ?? null
  }

  async findByOwnerId(ownerId: string): Promise<Resource[]> {
    return [...this.store.values()].filter((r) => r.ownerId === ownerId)
  }

  async save(resource: Resource): Promise<void> {
    this.store.set(resource.id, resource)
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id)
  }

  clear(): void {
    this.store.clear()
  }
}
