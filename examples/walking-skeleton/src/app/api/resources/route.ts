import { isResourcesEnabled } from '@/shared/featureFlags'
import { handleApiError } from '@/shared/handleApiError'
import { NotFoundError } from '@/shared/errors'
import { createResourceSchema } from '@/application/validators/resourceSchemas'
import { requireUser } from '@/application/authz/resourceGuards'
import { CreateResourceUseCase } from '@/application/use-cases/CreateResourceUseCase'
import { ListResourcesUseCase } from '@/application/use-cases/ListResourcesUseCase'
import { resourceRepository, authProvider } from '@/infrastructure/composition'

function ensureEnabled(): void {
  if (!isResourcesEnabled()) throw new NotFoundError('Recurso')
}

export async function GET(req: Request): Promise<Response> {
  try {
    ensureEnabled()
    const user = requireUser(await authProvider.getUser(req))
    const resources = await new ListResourcesUseCase(resourceRepository).execute(user.id)
    return Response.json(resources, { status: 200 })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    ensureEnabled()
    const user = requireUser(await authProvider.getUser(req))
    const dto = createResourceSchema.parse(await req.json())
    const resource = await new CreateResourceUseCase(resourceRepository).execute(dto, user.id)
    return Response.json(resource, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}
