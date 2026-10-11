import { isDevEnvironment } from '@/shared/appEnv'

type Env = Record<string, string | undefined>

export interface McpConfig {
  /** URL pública do MCP neste ambiente = `resource` (RFC 9728) = audience no Auth0. */
  resourceUrl: URL
  /** Auth0 do ambiente (ADR-004); null → só tokens pessoais. */
  issuerBaseUrl: URL | null
  resourceMetadataUrl: string
}

function parseUrl(name: string, value: string, isDev: boolean): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} inválida: ${value}`)
  }
  if (!isDev && url.protocol !== 'https:') throw new Error(`${name} precisa ser https fora do Dev local`)
  return url
}

export function loadMcpConfig(env: Env = process.env): McpConfig {
  const isDev = isDevEnvironment(env)
  if (!env.MCP_RESOURCE_URL) throw new Error('MCP_RESOURCE_URL não configurada')
  const resourceUrl = parseUrl('MCP_RESOURCE_URL', env.MCP_RESOURCE_URL, isDev)
  const issuerBaseUrl = env.AUTH0_ISSUER_BASE_URL
    ? parseUrl('AUTH0_ISSUER_BASE_URL', env.AUTH0_ISSUER_BASE_URL, isDev)
    : null
  return {
    resourceUrl,
    issuerBaseUrl,
    resourceMetadataUrl: `${resourceUrl.origin}/.well-known/oauth-protected-resource`,
  }
}
