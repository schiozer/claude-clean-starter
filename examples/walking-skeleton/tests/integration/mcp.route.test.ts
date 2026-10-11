import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { POST } from '@/app/api/mcp/route'
import { GET as wellKnown } from '@/app/.well-known/oauth-protected-resource/route'
import { mcpAuditLog, mcpRateLimiter, personalTokens, resourceRepository } from '@/composition'
import { rpc } from '../helpers/mcpRequest'

const names = async (res: Response) =>
  (await res.json()).result.tools.map((t: { name: string }) => t.name)

describe('/api/mcp', () => {
  let readToken: string
  let writeToken: string

  beforeEach(async () => {
    process.env.APP_ENV = 'development'
    process.env.MCP_RESOURCE_URL = 'http://localhost/api/mcp'
    resourceRepository.clear()
    personalTokens.clear()
    mcpRateLimiter.clear()
    mcpAuditLog.clear()
    readToken = await personalTokens.issue({ userId: 'ana', tenantId: 't1', scopes: ['resources:read'] })
    writeToken = await personalTokens.issue({
      userId: 'ana',
      tenantId: 't1',
      scopes: ['resources:read', 'resources:write'],
    })
  })
  afterEach(() => {
    for (const k of ['APP_ENV', 'MCP_RESOURCE_URL', 'MCP_RESOURCES_READ', 'MCP_RESOURCES_WRITE']) delete process.env[k]
    vi.restoreAllMocks()
  })

  it('sem token → 401 com WWW-Authenticate apontando o resource_metadata', async () => {
    const res = await POST(rpc('tools/list'))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource"'
    )
  })

  it('PAT revogado → 401 invalid_token', async () => {
    await personalTokens.revoke(readToken)
    const res = await POST(rpc('tools/list', {}, readToken))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })

  it('PAT expirado → 401', async () => {
    const expired = await personalTokens.issue({
      userId: 'ana',
      tenantId: 't1',
      scopes: ['resources:read'],
      expiresAt: new Date(Date.now() - 1000),
    })
    expect((await POST(rpc('tools/list', {}, expired))).status).toBe(401)
  })

  it('PAT de dev fora do Dev → 401', async () => {
    const devToken = await personalTokens.issue({ userId: 'ana', tenantId: 't1', scopes: ['resources:read'], devOnly: true })
    process.env.APP_ENV = 'uat'
    process.env.MCP_RESOURCE_URL = 'https://uat.example.com/api/mcp'
    expect((await POST(rpc('tools/list', {}, devToken))).status).toBe(401)
  })

  it('token não-PAT sem Auth0 configurado → 401', async () => {
    expect((await POST(rpc('tools/list', {}, 'eyJhbGciOi.qualquer.coisa'))).status).toBe(401)
  })

  it('tools/list esconde create_resource com a flag de escrita desligada (padrão)', async () => {
    expect(await names(await POST(rpc('tools/list', {}, writeToken)))).toEqual(['list_resources'])
  })

  it('flag de escrita ligada: create_resource aparece só para quem tem resources:write', async () => {
    process.env.MCP_RESOURCES_WRITE = 'on'
    expect(await names(await POST(rpc('tools/list', {}, writeToken)))).toEqual(['list_resources', 'create_resource'])
    expect(await names(await POST(rpc('tools/list', {}, readToken)))).toEqual(['list_resources'])
  })

  it('tools/call list_resources devolve só os recursos do actor do token', async () => {
    resourceRepository.seed([
      { ownerId: 'ana', tenantId: 't1', title: 'Da Ana' },
      { ownerId: 'bia', tenantId: 't1', title: 'Da Bia' },
      { ownerId: 'ana', tenantId: 't2', title: 'Ana em outro tenant' },
    ])
    const res = await POST(rpc('tools/call', { name: 'list_resources', arguments: {} }, readToken))
    const { result } = await res.json()
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.items.map((r: { title: string }) => r.title)).toEqual(['Da Ana'])
  })

  it('create_resource chamado com a flag desligada → isError NOT_FOUND e nada persiste', async () => {
    const res = await POST(rpc('tools/call', { name: 'create_resource', arguments: { title: 'Novo' } }, writeToken))
    expect((await res.json()).result).toMatchObject({ isError: true, _meta: { code: 'NOT_FOUND' } })
    expect(await resourceRepository.findByOwner('t1', 'ana', { limit: 10 })).toHaveLength(0)
  })

  it('create_resource ignora ownerId/tenantId dos arguments e audita', async () => {
    process.env.MCP_RESOURCES_WRITE = 'on'
    const args = { title: 'Pelo ChatGPT', ownerId: 'bia', tenantId: 't2' }
    const res = await POST(rpc('tools/call', { name: 'create_resource', arguments: args }, writeToken))
    const { result } = await res.json()
    expect(result.structuredContent).toMatchObject({ title: 'Pelo ChatGPT', ownerId: 'ana' })
    expect(await resourceRepository.findByOwner('t2', 'bia', { limit: 10 })).toHaveLength(0)
    expect(mcpAuditLog.entries).toEqual([expect.objectContaining({ actorId: 'ana', tool: 'create_resource', outcome: 'ok' })])
  })

  it('erro funcional → isError com a mensagem acionável', async () => {
    process.env.MCP_RESOURCES_WRITE = 'on'
    const res = await POST(rpc('tools/call', { name: 'create_resource', arguments: { title: 'ab' } }, writeToken))
    const { result } = await res.json()
    expect(result).toMatchObject({ isError: true, _meta: { code: 'VALIDATION_ERROR' } })
    expect(result.content[0].text).toContain('3 a 100')
  })

  it('erro técnico → isError genérico, sem detalhe interno', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(resourceRepository, 'findByOwner').mockRejectedValueOnce(new Error('pool exhausted'))
    const res = await POST(rpc('tools/call', { name: 'list_resources', arguments: {} }, readToken))
    const { result } = await res.json()
    expect(result).toMatchObject({ isError: true, _meta: { code: 'INTERNAL_ERROR' } })
    expect(JSON.stringify(result)).not.toContain('pool')
  })
})

describe('/.well-known/oauth-protected-resource', () => {
  afterEach(() => {
    for (const k of ['MCP_RESOURCE_URL', 'AUTH0_ISSUER_BASE_URL']) delete process.env[k]
  })

  it('aponta o Auth0 do ambiente e os escopos das tools', async () => {
    process.env.MCP_RESOURCE_URL = 'https://uat.example.com/api/mcp'
    process.env.AUTH0_ISSUER_BASE_URL = 'https://uat-tenant.auth0.com/'
    const body = await wellKnown().json()
    expect(body).toEqual({
      resource: 'https://uat.example.com/api/mcp',
      authorization_servers: ['https://uat-tenant.auth0.com/'],
      scopes_supported: ['resources:read', 'resources:write'],
      bearer_methods_supported: ['header'],
    })
  })
})
