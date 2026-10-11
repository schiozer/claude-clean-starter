import { systemClock } from '@/shared/kernel'
import type { IResourceRepository, PageRequest } from '../domain/IResourceRepository'
import { Resource, type ResourceSnapshot } from '../domain/Resource'
import { Title } from '../domain/Title'

export class InMemoryResourceRepository implements IResourceRepository {
  private store = new Map<string, ResourceSnapshot>()

  async save(resource: Resource): Promise<void> {
    this.store.set(resource.id.value, resource.toSnapshot())
  }

  async findByOwner(tenantId: string, ownerId: string, page: PageRequest): Promise<Resource[]> {
    const owned = [...this.store.values()].filter(
      (s) => s.tenantId === tenantId && s.ownerId === ownerId
    )
    let start = 0
    if (page.cursor !== undefined) {
      const index = owned.findIndex((s) => s.id === page.cursor)
      if (index === -1) return []
      start = index + 1
    }
    return owned.slice(start, start + page.limit).map((s) => Resource.rehydrate(s))
  }

  clear(): void {
    this.store.clear()
  }

  /** Dados de exemplo para Dev e testes. */
  seed(items: { ownerId: string; tenantId: string; title: string }[]): void {
    for (const item of items) {
      const resource = Resource.create(
        { tenantId: item.tenantId, ownerId: item.ownerId, title: Title.of(item.title) },
        systemClock
      )
      this.store.set(resource.id.value, resource.toSnapshot())
    }
  }
}
