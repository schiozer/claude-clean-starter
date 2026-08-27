import { Resource } from '@/domain/entities/Resource'

export interface IResourceRepository {
  findById(id: string): Promise<Resource | null>
  findByOwnerId(ownerId: string): Promise<Resource[]>
  save(resource: Resource): Promise<void>
  delete(id: string): Promise<void>
}
