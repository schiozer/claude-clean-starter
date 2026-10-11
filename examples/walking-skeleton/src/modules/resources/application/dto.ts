import { z } from 'zod'
import type { Resource } from '../domain/Resource'

export const resourceDTOSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerId: z.string(),
  createdAt: z.string().datetime(),
})
export type ResourceDTO = z.infer<typeof resourceDTOSchema>

export const resourcePageSchema = z.object({
  items: z.array(resourceDTOSchema),
  nextCursor: z.string().nullable(),
})
export type ResourcePage = z.infer<typeof resourcePageSchema>

export function toResourceDTO(resource: Resource): ResourceDTO {
  return {
    id: resource.id.value,
    title: resource.title.value,
    ownerId: resource.ownerId,
    createdAt: resource.createdAt.toISOString(),
  }
}

export function toResourcePage(items: ResourceDTO[], limit: number): ResourcePage {
  const isFull = items.length === limit && items.length > 0
  return { items, nextCursor: isFull ? items[items.length - 1].id : null }
}
