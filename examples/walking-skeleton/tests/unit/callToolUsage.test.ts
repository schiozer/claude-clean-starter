import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import {
  callTool,
  defineTool,
  estimateTokens,
  InMemoryAuditLog,
  InMemoryRateLimiter,
  InMemoryUsageMeter,
  type CallToolDeps,
  type IUsageMeter,
} from '@/shared/mcp'
import { logError } from '@/shared/logError'
import { makeActor } from '../helpers/makeActor'
import { fixedClock } from '../helpers/fixedClock'

vi.mock('@/shared/logError', () => ({ logError: vi.fn() }))

let nextOutput: unknown = { items: [] as string[] }
let nextContent: Array<Record<string, unknown>> | null = null

const tools = [
  defineTool({
    name: 'list_things',
    description: 'x',
    input: z.object({}),
    scope: 'things:read',
    annotations: { readOnlyHint: true },
    flag: 'mcp.resources.read',
    handler: async () => nextOutput as never,
  }),
]

const ana = makeActor({ id: 'ana', tenantId: 't1', via: 'pat', scopes: ['things:read'] })
const ON = { RESOURCES_ENABLED: 'on', USO_MCP_OBSERVABILIDADE: 'on' }

let usage: InMemoryUsageMeter
let rateLimiter: InMemoryRateLimiter
const deps = (over: Partial<CallToolDeps> = {}): CallToolDeps => ({
  audit: new InMemoryAuditLog(),
  rateLimiter,
  usage,
  clock: fixedClock,
  env: ON,
  ...over,
})

beforeEach(() => {
  usage = new InMemoryUsageMeter()
  rateLimiter = new InMemoryRateLimiter({ limit: 100, windowMs: 60_000 }, fixedClock)
  nextOutput = { items: [] }
  nextContent = null
})
afterEach(() => vi.clearAllMocks())

describe('callTool — medição de uso', () => {
  it('CT-MCPU-001 sucesso gera uma entrada completa e não altera a resposta', async () => {
    const measured = await callTool(tools, ana, 'list_things', {}, deps())
    const unmeasured = await callTool(tools, ana, 'list_things', {}, deps({ env: { RESOURCES_ENABLED: 'on' } }))

    expect(usage.entries).toEqual([
      {
        at: '2026-01-01T00:00:00.000Z',
        tenantId: 't1',
        tool: 'list_things',
        outcome: 'ok',
        latencyMs: 0,
        outputTokensEst: estimateTokens('{"items":[]}'),
      },
    ])
    expect(measured).toEqual(unmeasured)
  })

  it('CT-MCPU-002 erro de escopo é medido com o código', async () => {
    const semEscopo = makeActor({ id: 'bia', tenantId: 't2', scopes: [] })
    await callTool(tools, semEscopo, 'list_things', {}, deps())
    expect(usage.entries).toEqual([
      expect.objectContaining({ tenantId: 't2', tool: 'list_things', outcome: 'error', code: 'FORBIDDEN' }),
    ])
  })

  it('rate limit estourado é medido como RATE_LIMITED', async () => {
    rateLimiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 }, fixedClock)
    await callTool(tools, ana, 'list_things', {}, deps())
    await callTool(tools, ana, 'list_things', {}, deps())
    expect(usage.entries.map((e) => e.code)).toEqual([undefined, 'RATE_LIMITED'])
  })

  it('CT-MCPU-003 tool inexistente não é medida', async () => {
    await callTool(tools, ana, 'drop_tables', {}, deps())
    expect(usage.entries).toHaveLength(0)
  })

  it('CT-MCPU-004 medidor que rejeita não afeta a tool e é logado', async () => {
    const broken: IUsageMeter = { record: () => Promise.reject(new Error('neon fora')) }
    const result = await callTool(tools, ana, 'list_things', {}, deps({ usage: broken }))
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({ items: [] })
    expect(logError).toHaveBeenCalledWith('mcp:usage', expect.any(Error))
  })

  it('CT-MCPU-004 medidor que lança sincronamente não afeta a tool e é logado', async () => {
    const throwing: IUsageMeter = {
      record: () => {
        throw new Error('sync')
      },
    }
    const result = await callTool(tools, ana, 'list_things', {}, deps({ usage: throwing }))
    expect(result.isError).toBeFalsy()
    expect(logError).toHaveBeenCalledWith('mcp:usage', expect.any(Error))
  })

  it('CT-MCPU-005 medidor lento não atrasa além do timeout, sem unhandledRejection tardio', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    let rejectLate: (e: Error) => void = () => {}
    const slow: IUsageMeter = { record: () => new Promise<void>((_, reject) => (rejectLate = reject)) }

    const started = Date.now()
    const result = await callTool(tools, ana, 'list_things', {}, deps({ usage: slow, usageTimeoutMs: 20 }))
    const elapsed = Date.now() - started

    expect(result.isError).toBeFalsy()
    expect(elapsed).toBeLessThan(200)
    rejectLate(new Error('tarde'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('CT-MCPU-006 flag desligada não mede e a resposta é idêntica', async () => {
    const spy: IUsageMeter = { record: vi.fn(async () => {}) }
    const off = await callTool(tools, ana, 'list_things', {}, deps({ usage: spy, env: { RESOURCES_ENABLED: 'on' } }))
    const on = await callTool(tools, ana, 'list_things', {}, deps())
    expect(spy.record).not.toHaveBeenCalled()
    expect(off).toEqual(on)
  })

  it('CT-MCPU-007 a entrada não carrega argumentos, resposta nem id do ator', async () => {
    nextOutput = { segredo: 'conteudo-sigiloso-da-resposta' }
    await callTool(tools, ana, 'list_things', { ignorado: 'argumento-sigiloso' }, deps())
    const serialized = JSON.stringify(usage.entries)
    expect(serialized).not.toContain('argumento-sigiloso')
    expect(serialized).not.toContain('conteudo-sigiloso')
    expect(serialized).not.toContain('ana')
  })

  it('resposta enorme: estimativa correta', async () => {
    nextOutput = 'x'.repeat(400_000)
    await callTool(tools, ana, 'list_things', {}, deps())
    // JSON.stringify de uma string adiciona 2 aspas
    expect(usage.entries[0]?.outputTokensEst).toBe(estimateTokens('x'.repeat(400_002)))
  })

  it('ator de sistema registra o tenantId dele', async () => {
    const sistema = makeActor({ id: 'cron', tenantId: 'sys', via: 'system', scopes: ['things:read'] })
    await callTool(tools, sistema, 'list_things', {}, deps())
    expect(usage.entries[0]).toMatchObject({ tenantId: 'sys' })
  })
})

describe('callTool — blocos de conteúdo', () => {
  it('conta só os blocos text, sem lançar com outros tipos', async () => {
    const { countOutputTokens } = await import('@/shared/mcp/callTool')
    nextContent = [
      { type: 'text', text: 'abcdefgh' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ]
    expect(countOutputTokens({ content: nextContent as never })).toBe(2)
  })
})
