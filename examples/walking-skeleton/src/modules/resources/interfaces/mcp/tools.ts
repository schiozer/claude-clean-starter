import { defineTool, type AnyTool } from '@/shared/mcp'
import type { ResourceService } from '../../application/ResourceService'
import { createResourceSchema, listResourcesSchema } from '../../application/schemas'
import { resourceDTOSchema, resourcePageSchema, toResourcePage } from '../../application/dto'

export const makeResourceTools = (service: ResourceService): AnyTool[] => [
  defineTool({
    name: 'list_resources',
    description:
      'Lista os recursos do usuário, do mais antigo ao mais novo. Use para responder "quais são meus recursos". ' +
      'Se vier nextCursor, passe-o em cursor para a próxima página.',
    input: listResourcesSchema,
    output: resourcePageSchema,
    scope: 'resources:read',
    annotations: { readOnlyHint: true },
    flag: 'mcp.resources.read',
    handler: async (actor, input) => toResourcePage(await service.list(actor, input), input.limit),
  }),
  defineTool({
    name: 'create_resource',
    description: 'Cria um recurso do usuário com o título informado. Use quando ele pedir para criar/adicionar um recurso.',
    input: createResourceSchema,
    output: resourceDTOSchema,
    scope: 'resources:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    flag: 'mcp.resources.write',
    handler: (actor, input) => service.create(actor, input),
  }),
]
