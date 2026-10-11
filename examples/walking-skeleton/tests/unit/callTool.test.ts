import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { callTool, defineTool, InMemoryAuditLog, InMemoryRateLimiter } from '@/shared/mcp'
import { makeActor } from '../helpers/makeActor'
import { fixedClock } from '../helpers/fixedClock'

const readHandler = vi.fn(async () => ({ items: [] as string[] }))
const writeHandler = vi.fn(async (_actor: unknown, input: Record<string, unknown>) => ({ received: input }))

const tools = [
  defineTool({
    name: 'list_things',
    description: 'x',
    input: z.object({}),
    scope: 'things:read',
    annotations: { readOnlyHint: true },
    flag: 'mcp.resources.read',
    handler: readHandler,
  }),
  defineTool({
    name: 'create_thing',
    description: 'x',
    input: z.object({ title: z.string().min(3, 'Título curto') }),
    scope: 'things:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    flag: 'mcp.resources.write',
    handler: writeHandler,
  }),
]

const writer = makeActor({ id: 'ana', tenantId: 't1', via: 'pat', scopes: ['things:read', 'things:write'] })
const WRITE_ON = { RESOURCES_ENABLED: 'on', MCP_RESOURCES_WRITE: 'on' }

let audit: InMemoryAuditLog
let rateLimiter: InMemoryRateLimiter
const deps = (env: Record<string, string> = WRITE_ON) => ({ audit, rateLimiter, clock: fixedClock, env })

beforeEach(() => {
  audit = new InMemoryAuditLog()
  rateLimiter = new InMemoryRateLimiter({ limit: 100, windowMs: 60_000 }, fixedClock)
})
afterEach(() => vi.clearAllMocks())

describe('callTool', () => {
  it('sucesso → structuredContent + texto JSON', async () => {
    const result = await callTool(tools, writer, 'list_things', {}, deps())
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({ items: [] })
    expect(result.content).toEqual([{ type: 'text', text: '{"items":[]}' }])
  })

  it('tool inexistente → NOT_FOUND', async () => {
    const result = await callTool(tools, writer, 'drop_tables', {}, deps())
    expect(result).toMatchObject({ isError: true, _meta: { code: 'NOT_FOUND' } })
  })

  it('flag de escrita desligada → NOT_FOUND e não executa nem audita', async () => {
    const result = await callTool(tools, writer, 'create_thing', { title: 'Novo' }, deps({ RESOURCES_ENABLED: 'on' }))
    expect(result._meta).toEqual({ code: 'NOT_FOUND' })
    expect(writeHandler).not.toHaveBeenCalled()
    expect(audit.entries).toHaveLength(0)
  })

  it('sem escopo → FORBIDDEN, não executa e audita o erro', async () => {
    const reader = makeActor({ id: 'ana', tenantId: 't1', scopes: ['things:read'] })
    const result = await callTool(tools, reader, 'create_thing', { title: 'Novo' }, deps())
    expect(result._meta).toEqual({ code: 'FORBIDDEN' })
    expect(writeHandler).not.toHaveBeenCalled()
    expect(audit.entries).toEqual([
      expect.objectContaining({ actorId: 'ana', tool: 'create_thing', outcome: 'error', code: 'FORBIDDEN' }),
    ])
  })

  it('args inválidos → VALIDATION_ERROR com a mensagem do schema', async () => {
    const result = await callTool(tools, writer, 'create_thing', { title: 'a' }, deps())
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Título curto' }] })
    expect(writeHandler).not.toHaveBeenCalled()
  })

  it('descarta ownerId/tenantId vindos da LLM', async () => {
    await callTool(tools, writer, 'create_thing', { title: 'Novo', ownerId: 'bia', tenantId: 't2' }, deps())
    expect(writeHandler).toHaveBeenCalledWith(writer, { title: 'Novo' })
  })

  it('escrita ok → auditada sem payload', async () => {
    await callTool(tools, writer, 'create_thing', { title: 'Novo' }, deps())
    expect(audit.entries).toEqual([
      { at: '2026-01-01T00:00:00.000Z', actorId: 'ana', tenantId: 't1', via: 'pat', tool: 'create_thing', outcome: 'ok' },
    ])
  })

  it('leitura não é auditada', async () => {
    await callTool(tools, writer, 'list_things', {}, deps())
    expect(audit.entries).toHaveLength(0)
  })

  it('rate limit estourado → RATE_LIMITED e não executa', async () => {
    rateLimiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 }, fixedClock)
    await callTool(tools, writer, 'list_things', {}, deps())
    const result = await callTool(tools, writer, 'list_things', {}, deps())
    expect(result._meta).toEqual({ code: 'RATE_LIMITED' })
    expect(readHandler).toHaveBeenCalledTimes(1)
  })

  it('falha técnica no handler → mensagem genérica (e loga)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readHandler.mockRejectedValueOnce(new Error('db down'))
    const result = await callTool(tools, writer, 'list_things', {}, deps())
    expect(result).toMatchObject({ isError: true, _meta: { code: 'INTERNAL_ERROR' } })
    expect(JSON.stringify(result)).not.toContain('db down')
    spy.mockRestore()
  })
})

describe('callTool — auditoria indisponível', () => {
  it('escrita já feita não vira erro se o audit.record falhar (loga e devolve o resultado)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failingAudit = { record: vi.fn(async () => Promise.reject(new Error('audit db down'))) }
    const result = await callTool(tools, writer, 'create_thing', { title: 'Novo' }, { ...deps(), audit: failingAudit })
    expect(result.isError).toBeFalsy()
    expect(writeHandler).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('[mcp:audit]', expect.objectContaining({ message: 'audit db down' }))
    spy.mockRestore()
  })
})
