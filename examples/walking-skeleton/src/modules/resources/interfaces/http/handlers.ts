import type { ResolveActor } from '@/shared/auth'
import { ensureEnabled } from '@/shared/featureFlags'
import { handleApiError } from '@/shared/handleApiError'
import type { ResourceService } from '../../application/ResourceService'
import { toResourcePage } from '../../application/dto'
import { createResourceSchema, listResourcesSchema } from '../../application/schemas'

function listInputFrom(url: string): unknown {
  const params = new URL(url).searchParams
  const limit = params.get('limit')
  return {
    limit: limit === null ? undefined : Number(limit),
    cursor: params.get('cursor') ?? undefined,
  }
}

export const makeResourceHandlers = (service: ResourceService, resolveActor: ResolveActor) => ({
  async GET(req: Request): Promise<Response> {
    try {
      ensureEnabled('resources')
      const actor = await resolveActor(req)
      const input = listResourcesSchema.parse(listInputFrom(req.url))
      return Response.json(toResourcePage(await service.list(actor, input), input.limit))
    } catch (error) {
      return handleApiError(error, 'api/resources:GET')
    }
  },

  async POST(req: Request): Promise<Response> {
    try {
      ensureEnabled('resources')
      const actor = await resolveActor(req)
      const input = createResourceSchema.parse(await req.json())
      return Response.json(await service.create(actor, input), { status: 201 })
    } catch (error) {
      return handleApiError(error, 'api/resources:POST')
    }
  },
})
