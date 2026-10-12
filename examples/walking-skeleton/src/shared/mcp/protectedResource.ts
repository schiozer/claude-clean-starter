import { logError } from '@/shared/logError'
import { loadMcpConfig } from './config'
import type { AnyTool } from './defineTool'

type Env = Record<string, string | undefined>

/** GET /.well-known/oauth-protected-resource (RFC 9728) — aponta o Auth0 do ambiente. */
export function makeProtectedResourceMetadataHandler(tools: readonly AnyTool[], env: Env = process.env) {
  const scopes = [...new Set(tools.map((t) => t.scope))]
  return {
    GET(): Response {
      try {
        const config = loadMcpConfig(env)
        return Response.json({
          resource: config.resourceUrl.href,
          authorization_servers: config.issuerBaseUrl ? [config.issuerBaseUrl.href] : [],
          scopes_supported: scopes,
          bearer_methods_supported: ['header'],
        })
      } catch (error) {
        logError('mcp:protected-resource', error)
        return Response.json({ error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' }, { status: 500 })
      }
    },
  }
}
