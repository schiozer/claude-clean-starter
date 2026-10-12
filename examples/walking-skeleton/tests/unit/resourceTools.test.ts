import { describe, it, expect, beforeEach } from 'vitest'
import { ResourceService, makeResourceTools } from '@/modules/resources'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'
import { makeActor } from '../helpers/makeActor'
import { fixedClock } from '../helpers/fixedClock'

let tools: ReturnType<typeof makeResourceTools>
const byName = (name: string) => {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool ${name} ausente`)
  return tool
}

beforeEach(() => {
  tools = makeResourceTools(new ResourceService(new InMemoryResourceRepository(), fixedClock))
})

describe('makeResourceTools', () => {
  it('declara escopo, flag e anotações honestas', () => {
    expect(byName('list_resources')).toMatchObject({
      scope: 'resources:read',
      flag: 'mcp.resources.read',
      annotations: { readOnlyHint: true, openWorldHint: false },
    })
    expect(byName('create_resource')).toMatchObject({
      scope: 'resources:write',
      flag: 'mcp.resources.write',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    })
  })

  it('create → list devolve página com o recurso do actor', async () => {
    const actor = makeActor({ scopes: ['resources:read', 'resources:write'] })
    await byName('create_resource').handler(actor, { title: 'Pelo MCP' })
    const page = await byName('list_resources').handler(actor, { limit: 20 })
    expect(page).toMatchObject({ items: [{ title: 'Pelo MCP', ownerId: 'user-1' }], nextCursor: null })
  })

  it('a saída do list respeita o outputSchema declarado', async () => {
    const actor = makeActor({ scopes: ['resources:read'] })
    const tool = byName('list_resources')
    expect(tool.output?.safeParse(await tool.handler(actor, { limit: 5 })).success).toBe(true)
  })
})
