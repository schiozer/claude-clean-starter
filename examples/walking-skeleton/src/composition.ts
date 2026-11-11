// src/composition.ts
// Único arquivo que importa infrastructure/: instancia repositórios, services e bordas.
import { ResourceService, makeResourceHandlers, makeResourceTools } from '@/modules/resources'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'
import {
  Auth0JwtVerifier,
  CompositeTokenVerifier,
  InMemoryPersonalTokenStore,
  PersonalTokenVerifier,
  StubAuthProvider,
  makeSessionResolver,
  type IssueTokenInput,
} from '@/shared/auth'
import { E2eCookieAuthProvider, loadE2eSessionConfig } from '@/shared/auth/E2eCookieAuthProvider'
import { isDevEnvironment, isE2eLocalEnvironment } from '@/shared/appEnv'
import { withRouteTimeout } from '@/shared/http/withRouteTimeout'
import { systemClock } from '@/shared/kernel'
import { logError } from '@/shared/logError'
import {
  InMemoryAuditLog,
  InMemoryRateLimiter,
  createMcpHandler,
  makeProtectedResourceMetadataHandler,
  type McpConfig,
} from '@/shared/mcp'

// Módulo resources
export const resourceRepository = new InMemoryResourceRepository()
const resourceService = new ResourceService(resourceRepository, systemClock)

// Sessão web: cookie assinado no modo E2E local (Playwright); senão o stub do Dev local.
const isE2eLocal = isE2eLocalEnvironment()
export const e2eSessions = isE2eLocal
  ? new E2eCookieAuthProvider({ ...loadE2eSessionConfig(), clock: systemClock })
  : null
const resolveSessionActor = makeSessionResolver(e2eSessions ?? new StubAuthProvider())

// Borda REST com prazo por rota (RNF-TMO-001)
const DEFAULT_API_TIMEOUT_MS = 10_000
const apiTimeoutMs = (() => {
  const parsed = Number(process.env.API_TIMEOUT_MS)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_API_TIMEOUT_MS
})()
const rawResourceHandlers = makeResourceHandlers(resourceService, resolveSessionActor)
export const resourceHandlers = {
  GET: withRouteTimeout(rawResourceHandlers.GET, apiTimeoutMs, 'api/resources:GET'),
  POST: withRouteTimeout(rawResourceHandlers.POST, apiTimeoutMs, 'api/resources:POST'),
}

// Borda MCP (bearer: OAuth Auth0 ou token pessoal)
export const personalTokens = new InMemoryPersonalTokenStore(systemClock)
const personalTokenVerifier = new PersonalTokenVerifier(personalTokens, systemClock)

type FixedToken = Pick<IssueTokenInput, 'userId' | 'scopes'> & { envVar: string }

/** PATs fixos vindos do env (só Dev/E2E local: `devOnly`); variável ausente/vazia → não emite. */
const FIXED_TOKENS: FixedToken[] = isE2eLocal
  ? [
      {
        envVar: 'DEV_PERSONAL_TOKEN',
        userId: 'dev-user',
        scopes: ['resources:read', 'resources:write', 'ajuda:read'],
      },
      { envVar: 'E2E_PAT_SEM_ESCOPO', userId: 'e2e-sem-escopo', scopes: [] },
      { envVar: 'E2E_PAT_RATE_LIMIT', userId: 'e2e-rate-limit', scopes: ['resources:read'] },
    ]
  : isDevEnvironment()
    ? [
        {
          envVar: 'DEV_PERSONAL_TOKEN',
          userId: 'dev-user',
          scopes: ['resources:read', 'resources:write'],
        },
      ]
    : []

for (const { envVar, userId, scopes } of FIXED_TOKENS) {
  const token = process.env[envVar]
  if (!token) continue
  personalTokens
    .issue({ userId, tenantId: 'dev-tenant', scopes, token, devOnly: true })
    .catch((error) => logError(`composition:personal-token:${envVar}`, error))
}

const verifierFor = (config: McpConfig) =>
  new CompositeTokenVerifier(
    personalTokenVerifier,
    config.issuerBaseUrl
      ? new Auth0JwtVerifier({ issuer: config.issuerBaseUrl.href, audience: config.resourceUrl.href })
      : null
  )

const mcpTools = [...makeResourceTools(resourceService)]

export const mcpRateLimiter = new InMemoryRateLimiter({ limit: 60, windowMs: 60_000 }, systemClock)
export const mcpAuditLog = new InMemoryAuditLog()

export const mcpHandler = createMcpHandler({
  tools: mcpTools,
  verifierFor,
  rateLimiter: mcpRateLimiter,
  audit: mcpAuditLog,
})

export const protectedResourceMetadata = makeProtectedResourceMetadataHandler(mcpTools)
