export {
  createResourceSchema,
  listResourcesSchema,
  type CreateResourceInput,
  type ListResourcesInput,
} from './application/schemas'
export {
  resourceDTOSchema,
  resourcePageSchema,
  toResourceDTO,
  toResourcePage,
  type ResourceDTO,
  type ResourcePage,
} from './application/dto'
export { ResourceService } from './application/ResourceService'
export { makeResourceHandlers } from './interfaces/http/handlers'
