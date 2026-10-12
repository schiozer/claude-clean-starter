import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import type { ZodTypeAny } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { readBearerToken, type AuthUser, type IAccessTokenVerifier } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'
import { logError } from '@/shared/logError'
import type { IAuditLog } from './audit'
import { callTool } from './callTool'
import { loadMcpConfig, type McpConfig } from './config'
import type { AnyTool } from './defineTool'
import type { IRateLimiter } from './rateLimit'
import { assertValidTools, visibleTools } from './registry'

type Env = Record<string, string | undefined>

export interface McpHandlerDeps {
  tools: readonly AnyTool[]
  verifierFor: (config: McpConfig) => IAccessTokenVerifier
  rateLimiter: IRateLimiter
  audit: IAuditLog
  env?: Env
  info?: { name: string; version: string }
}

const DEFAULT_INFO = { name: 'walking-skeleton', version: '0.1.0' }

function jsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>
  delete json.$schema
  return json
}

function toListedTool(tool: AnyTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: jsonSchema(tool.input) as Tool['inputSchema'],
    ...(tool.output ? { outputSchema: jsonSchema(tool.output) as Tool['outputSchema'] } : {}),
    annotations: tool.annotations,
  }
}

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers })
}

function unauthorized(config: McpConfig, invalidToken: boolean): Response {
  const params = [`resource_metadata="${config.resourceMetadataUrl}"`]
  if (invalidToken) params.push('error="invalid_token"')
  return jsonRpcError(401, -32001, 'Não autorizado', { 'www-authenticate': `Bearer ${params.join(', ')}` })
}

const internalError = () => jsonRpcError(500, -32603, 'Erro interno. Tente novamente.')

function buildServer(deps: McpHandlerDeps, actor: AuthUser, env: Env): Server {
  const server = new Server(deps.info ?? DEFAULT_INFO, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleTools(deps.tools, actor, env).map(toListedTool),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callTool(deps.tools, actor, request.params.name, request.params.arguments, {
      rateLimiter: deps.rateLimiter,
      audit: deps.audit,
      env,
    })
  )
  return server
}

/** POST /api/mcp — Streamable HTTP stateless: um Server + transporte por requisição (ADR-012). */
export function createMcpHandler(deps: McpHandlerDeps) {
  assertValidTools(deps.tools)
  const env = deps.env ?? process.env

  return async function handleMcp(req: Request): Promise<Response> {
    let config: McpConfig
    try {
      config = loadMcpConfig(env)
    } catch (error) {
      logError('mcp:config', error)
      return internalError()
    }

    const token = readBearerToken(req)
    if (!token) return unauthorized(config, false)

    let actor: AuthUser
    try {
      actor = await deps.verifierFor(config).verify(token)
    } catch (error) {
      if (error instanceof UnauthorizedError) return unauthorized(config, true)
      logError('mcp:auth', error)
      return internalError()
    }

    const server = buildServer(deps, actor, env)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    return transport.handleRequest(req)
  }
}
