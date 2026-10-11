import { z } from 'zod'
import { TITLE_RULE } from '../domain/Title'

export const createResourceSchema = z.object({
  title: z.string().trim().min(3, TITLE_RULE).max(100, TITLE_RULE).describe('Título do recurso'),
})

export const listResourcesSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20).describe('Quantidade máxima (≤ 50)'),
  cursor: z.string().optional().describe('Cursor devolvido pela página anterior (nextCursor)'),
})

export type CreateResourceInput = z.infer<typeof createResourceSchema>
export type ListResourcesInput = z.infer<typeof listResourcesSchema>
