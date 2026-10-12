import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { defineTool, loadMcpConfig, makeProtectedResourceMetadataHandler } from '@/shared/mcp'

afterEach(() => vi.restoreAllMocks())

const tool = (scope: string) =>
  defineTool({
    name: `t_${scope.replace(':', '_')}`,
    description: 'x',
    input: z.object({}),
    scope,
    annotations: { readOnlyHint: true },
    flag: 'mcp.resources.read',
    handler: async () => ({}),
  })

describe('loadMcpConfig', () => {
  it('lê URLs e deriva o resource_metadata do origin', () => {
    const c = loadMcpConfig({ MCP_RESOURCE_URL: 'https://uat.example.com/api/mcp', AUTH0_ISSUER_BASE_URL: 'https://t.auth0.com/' })
    expect(c.resourceUrl.href).toBe('https://uat.example.com/api/mcp')
    expect(c.issuerBaseUrl?.href).toBe('https://t.auth0.com/')
    expect(c.resourceMetadataUrl).toBe('https://uat.example.com/.well-known/oauth-protected-resource')
  })
  it('sem AUTH0_ISSUER_BASE_URL → issuer null (só PAT)', () => {
    expect(loadMcpConfig({ MCP_RESOURCE_URL: 'https://uat.example.com/api/mcp' }).issuerBaseUrl).toBeNull()
  })
  it('sem MCP_RESOURCE_URL → erro', () => {
    expect(() => loadMcpConfig({})).toThrow('MCP_RESOURCE_URL')
  })
  it('http fora do Dev → erro; http no Dev → ok', () => {
    expect(() => loadMcpConfig({ MCP_RESOURCE_URL: 'http://uat.example.com/api/mcp' })).toThrow('https')
    expect(() => loadMcpConfig({ MCP_RESOURCE_URL: 'https://x.com/api/mcp', AUTH0_ISSUER_BASE_URL: 'http://t.auth0.com/' })).toThrow('https')
    expect(loadMcpConfig({ MCP_RESOURCE_URL: 'http://localhost:3000/api/mcp', APP_ENV: 'development' }).resourceUrl.port).toBe('3000')
  })
  it('MCP_RESOURCE_URL sem caminho (só o origin) → erro: o resource é a URL exata do MCP', () => {
    expect(() => loadMcpConfig({ MCP_RESOURCE_URL: 'https://uat.example.com' })).toThrow('caminho')
    expect(() => loadMcpConfig({ MCP_RESOURCE_URL: 'https://uat.example.com/' })).toThrow('caminho')
  })

  it('URL malformada → erro', () => {
    expect(() => loadMcpConfig({ MCP_RESOURCE_URL: 'nao-e-url' })).toThrow('MCP_RESOURCE_URL')
  })
})

describe('makeProtectedResourceMetadataHandler', () => {
  const env = { MCP_RESOURCE_URL: 'https://uat.example.com/api/mcp', AUTH0_ISSUER_BASE_URL: 'https://t.auth0.com/' }

  it('devolve o metadado RFC 9728 com escopos únicos das tools', async () => {
    const handler = makeProtectedResourceMetadataHandler([tool('a:read'), tool('a:write'), tool('a:read')], env)
    const res = handler.GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      resource: 'https://uat.example.com/api/mcp',
      authorization_servers: ['https://t.auth0.com/'],
      scopes_supported: ['a:read', 'a:write'],
      bearer_methods_supported: ['header'],
    })
  })

  it('config inválida → 500 genérico e loga', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = makeProtectedResourceMetadataHandler([], {}).GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' })
    expect(spy).toHaveBeenCalled()
  })
})
