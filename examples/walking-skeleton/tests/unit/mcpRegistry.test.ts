import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineTool, visibleTools, assertValidTools } from '@/shared/mcp'
import { makeActor } from '../helpers/makeActor'

const readTool = defineTool({
  name: 'list_things',
  description: 'Lista coisas.',
  input: z.object({}),
  scope: 'things:read',
  annotations: { readOnlyHint: true },
  flag: 'mcp.resources.read',
  handler: async () => ({ items: [] }),
})

const writeTool = defineTool({
  name: 'create_thing',
  description: 'Cria coisa.',
  input: z.object({ title: z.string() }),
  scope: 'things:write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  flag: 'mcp.resources.write',
  handler: async (_actor, input) => ({ title: input.title }),
})

const tools = [readTool, writeTool]
const names = (ts: { name: string }[]) => ts.map((t) => t.name)
const both = makeActor({ scopes: ['things:read', 'things:write'] })

describe('visibleTools', () => {
  it('escrita fica oculta com a flag desligada (padrão), mesmo com escopo', () => {
    expect(names(visibleTools(tools, both, { RESOURCES_ENABLED: 'on' }))).toEqual(['list_things'])
  })
  it('flag ligada mas sem escopo → oculta', () => {
    const readOnly = makeActor({ scopes: ['things:read'] })
    expect(names(visibleTools(tools, readOnly, { RESOURCES_ENABLED: 'on', MCP_RESOURCES_WRITE: 'on' }))).toEqual(['list_things'])
  })
  it('flag ligada E escopo → visível', () => {
    expect(names(visibleTools(tools, both, { RESOURCES_ENABLED: 'on', MCP_RESOURCES_WRITE: 'on' }))).toEqual(['list_things', 'create_thing'])
  })
  it('flag de leitura desligada → leitura oculta', () => {
    expect(names(visibleTools(tools, both, { RESOURCES_ENABLED: 'on', MCP_RESOURCES_READ: 'off' }))).toEqual([])
  })
})

describe('assertValidTools', () => {
  it('lança com nomes duplicados', () => {
    expect(() => assertValidTools([readTool, readTool])).toThrow('list_things')
  })

  it('escopo de escrita atrás de flag de leitura → lança (escrita sempre nasce desligada)', () => {
    const sneaky = { ...readTool, name: 'sneaky_write', scope: 'things:write' }
    expect(() => assertValidTools([sneaky])).toThrow('sneaky_write')
  })

  it('catálogo coerente → não lança', () => {
    expect(() => assertValidTools([readTool, writeTool])).not.toThrow()
  })
})

describe('defineTool (contrato de tipos — checado pelo type-check)', () => {
  it('tool sem scope não compila; escrita com readOnlyHint: true não compila', () => {
    // @ts-expect-error scope é obrigatório
    defineTool({ name: 'x', description: 'x', input: z.object({}), annotations: { readOnlyHint: true }, flag: 'mcp.resources.read', handler: async () => ({}) })
    defineTool({
      name: 'y',
      description: 'y',
      input: z.object({}),
      scope: 's:write',
      // @ts-expect-error flag de escrita exige readOnlyHint: false + destructive/idempotent
      annotations: { readOnlyHint: true },
      flag: 'mcp.resources.write',
      handler: async () => ({}),
    })
    expect(true).toBe(true)
  })
})
