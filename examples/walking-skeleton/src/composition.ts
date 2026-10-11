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
} from '@/shared/auth'
import { isDevEnvironment } from '@/shared/appEnv'
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

// Borda REST (sessão web)
const resolveSessionActor = makeSessionResolver(new StubAuthProvider())
export const resourceHandlers = makeResourceHandlers(resourceService, resolveSessionActor)

// Borda MCP (bearer: OAuth Auth0 ou token pessoal)
export const personalTokens = new InMemoryPersonalTokenStore(systemClock)
const personalTokenVerifier = new PersonalTokenVerifier(personalTokens, systemClock)

const devToken = process.env.DEV_PERSONAL_TOKEN
if (isDevEnvironment() && devToken) {
  personalTokens
    .issue({
      userId: 'dev-user',
      tenantId: 'dev-tenant',
      scopes: ['resources:read', 'resources:write'],
      token: devToken,
      devOnly: true,
    })
    .catch((error) => logError('composition:dev-personal-token', error))
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
