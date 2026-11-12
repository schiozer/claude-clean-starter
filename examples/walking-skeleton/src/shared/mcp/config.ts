import { isDevEnvironment, isE2eLocalEnvironment } from '@/shared/appEnv'

type Env = Record<string, string | undefined>

export interface McpConfig {
  /** URL pública do MCP neste ambiente = `resource` (RFC 9728) = audience no Auth0. */
  resourceUrl: URL
  /** Auth0 do ambiente (ADR-004); null → só tokens pessoais. */
  issuerBaseUrl: URL | null
  resourceMetadataUrl: string
}

function parseUrl(name: string, value: string, allowHttp: boolean): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} inválida: ${value}`)
  }
  if (!allowHttp && url.protocol !== 'https:') {
    throw new Error(`${name} precisa ser https fora do Dev local e do modo E2E local`)
  }
  return url
}

export function loadMcpConfig(env: Env = process.env): McpConfig {
  // http só na máquina: Dev local ou o app do Playwright (`isE2eLocalEnvironment`, nunca na Vercel).
  const allowHttp = isDevEnvironment(env) || isE2eLocalEnvironment(env)
  if (!env.MCP_RESOURCE_URL) throw new Error('MCP_RESOURCE_URL não configurada')
  const resourceUrl = parseUrl('MCP_RESOURCE_URL', env.MCP_RESOURCE_URL, allowHttp)
  if (resourceUrl.pathname === '/') {
    throw new Error(
      'MCP_RESOURCE_URL precisa do caminho do MCP (ex.: https://<host>/api/mcp), não só o origin'
    )
  }
  const issuerBaseUrl = env.AUTH0_ISSUER_BASE_URL
    ? parseUrl('AUTH0_ISSUER_BASE_URL', env.AUTH0_ISSUER_BASE_URL, allowHttp)
    : null
  return {
    resourceUrl,
    issuerBaseUrl,
    resourceMetadataUrl: `${resourceUrl.origin}/.well-known/oauth-protected-resource`,
  }
}
