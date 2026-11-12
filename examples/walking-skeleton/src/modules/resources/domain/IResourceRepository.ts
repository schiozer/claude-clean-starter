import type { Resource } from './Resource'

export interface PageRequest {
  limit: number
  cursor?: string
}

export interface IResourceRepository {
  save(resource: Resource): Promise<void>
  /** Itens do owner no tenant, do mais novo ao mais antigo; `cursor` = id do último item já visto. */
  findByOwner(tenantId: string, ownerId: string, page: PageRequest): Promise<Resource[]>
}
