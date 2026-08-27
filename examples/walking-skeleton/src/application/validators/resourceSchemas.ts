import { z } from 'zod'

export const createResourceSchema = z.object({
  title: z.string().min(3).max(100),
})

export type CreateResourceDTO = z.infer<typeof createResourceSchema>
