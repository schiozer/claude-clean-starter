import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { createMcpHandler, defineTool, InMemoryAuditLog, InMemoryRateLimiter } from '@/shared/mcp'
import { UnauthorizedError } from '@/shared/errors'
import type { IAccessTokenVerifier } from '@/shared/auth'
import { makeActor } from '../helpers/makeActor'
import { rpc } from '../helpers/mcpRequest'

afterEach(() => vi.restoreAllMocks())

const ENV = { RESOURCES_ENABLED: 'on', MCP_RESOURCE_URL: 'http://localhost/api/mcp', APP_ENV: 'development' }

const listThings = defineTool({
  name: 'list_things',
  description: 'Lista coisas. Use para "quais são minhas coisas".',
  input: z.object({ limit: z.number().int().max(50).default(20).describe('Máximo') }),
  output: z.object({ items: z.array(z.string()) }),
  scope: 'things:read',
  annotations: { readOnlyHint: true },
  flag: 'mcp.resources.read',
  handler: async (actor) => ({ items: [`de ${actor.id}`] }),
})

const verifier: IAccessTokenVerifier = {
  async verify(token) {
    if (token === 'good') return makeActor({ id: 'ana', scopes: ['things:read'], via: 'pat' })
    if (token === 'boom') throw new Error('jwks fora do ar')
    throw new UnauthorizedError()
  },
}

const handler = (env: Record<string, string> = ENV) =>
  createMcpHandler({
    tools: [listThings],
    verifierFor: () => verifier,
    rateLimiter: new InMemoryRateLimiter({ limit: 100, windowMs: 60_000 }),
    audit: new InMemoryAuditLog(),
    env,
  })

describe('createMcpHandler — autenticação', () => {
  it('sem token → 401 com resource_metadata', async () => {
    const res = await handler()(rpc('tools/list'))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource"'
    )
  })

  it('token recusado → 401 com error="invalid_token"', async () => {
    const res = await handler()(rpc('tools/list', {}, 'bad'))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })

  it('falha técnica no verificador → 500 genérico e loga', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handler()(rpc('tools/list', {}, 'boom'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('jwks')
    expect(spy).toHaveBeenCalled()
  })

  it('config ausente → 500 e loga', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handler({})(rpc('tools/list', {}, 'good'))
    expect(res.status).toBe(500)
    expect(spy).toHaveBeenCalled()
  })
})

describe('createMcpHandler — tools', () => {
  it('tools/list publica JSON Schema (sem $schema), outputSchema e anotações', async () => {
    const res = await handler()(rpc('tools/list', {}, 'good'))
    expect(res.status).toBe(200)
    const [tool] = (await res.json()).result.tools
    expect(tool.name).toBe('list_things')
    expect(tool.inputSchema).toMatchObject({ type: 'object', properties: { limit: { type: 'integer', description: 'Máximo' } } })
    expect(tool.inputSchema.$schema).toBeUndefined()
    expect(tool.outputSchema).toMatchObject({ type: 'object' })
    expect(tool.annotations).toEqual({ readOnlyHint: true })
  })

  it('tools/call executa com o actor do token', async () => {
    const res = await handler()(rpc('tools/call', { name: 'list_things', arguments: {} }, 'good'))
    expect((await res.json()).result.structuredContent).toEqual({ items: ['de ana'] })
  })

  it('nomes de tool duplicados → erro na montagem', () => {
    expect(() =>
      createMcpHandler({
        tools: [listThings, listThings],
        verifierFor: () => verifier,
        rateLimiter: new InMemoryRateLimiter({ limit: 1, windowMs: 1 }),
        audit: new InMemoryAuditLog(),
      })
    ).toThrow('list_things')
  })
})
