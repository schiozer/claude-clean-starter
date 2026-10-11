# Arquitetura agêntica — Entrega 2 (walking skeleton → módulos + MCP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar `examples/walking-skeleton/` para `src/modules/resources/` (perfil completo) com `ResourceService` como porta única e expor `/api/mcp` (tools `list_resources` e `create_resource`) autenticado por OAuth Auth0 ou PAT.

**Architecture:** Módulo `resources` com domínio (VOs + aggregate + `IResourceRepository`), `ResourceService` (actor primeiro + guard), bordas REST e MCP finas criadas por factories e montadas em `src/composition.ts`. `src/shared/{kernel,auth,mcp}` trazem `Clock`, `AuthUser`/guards/verificadores de token e o servidor MCP (SDK oficial, low-level `Server` + `WebStandardStreamableHTTPServerTransport` stateless com resposta JSON).

**Tech Stack:** Next.js 15 (App Router), TypeScript estrito, Zod 3.25, Vitest 2, `@modelcontextprotocol/sdk` 1.32, `jose` 6, `zod-to-json-schema` 3.

**Spec:** `docs/superpowers/specs/2026-10-10-arquitetura-agentica-mcp-design.md` (§4.4, §4.6, §5, §6, §7, §8 Entrega 2). Decisões posteriores na ADR-011/ADR-012 e nos guias (`docs/guides/{testing,error-handling,zod,mcp}-guide.md`) prevalecem sobre a spec quando divergirem (ex.: `src/shared/errors.ts` arquivo, não pasta).

**Diretório de trabalho:** todos os comandos rodam em `examples/walking-skeleton/` salvo indicação.

## Global Constraints

- Todo método público do service recebe `actor: AuthUser` como 1º parâmetro e chama guard antes de tocar dados.
- `AuthUser = { id, tenantId, scopes: string[], via: 'session' | 'oauth' | 'pat' | 'system' }`; escopos `<ctx>:read` / `<ctx>:write`.
- Sem `actor` → `UnauthorizedError` (401); sem escopo ou sem posse → `ForbiddenError` (403, `FORBIDDEN`).
- Tool sem `scope` declarado **não compila**; tool sem flag ligada não é listada nem executável.
- Escrita MCP: flag **desligada por padrão**; `readOnlyHint: false` obrigatório.
- Tenant/owner sempre derivado do `actor`, **nunca** do input.
- MCP: autenticação → HTTP `401` + `WWW-Authenticate: Bearer resource_metadata="…"`; demais erros → `isError: true` (funcional acionável; técnico genérico, sem detalhes internos).
- PAT `pat_<random>`, persistido só como hash SHA-256, com escopos, `expiresAt`, `revokedAt`, `lastUsedAt`. PAT de dev só vale com `APP_ENV=development` (ausente = não é Dev).
- `Auth0JwtVerifier`: JWKS, `iss`, `aud` **contém** a URL do MCP do ambiente, `exp`, escopos.
- Fora do Dev local, só HTTPS (`MCP_RESOURCE_URL` e issuer `https://`).
- Saída paginada: `limit` ≤ 50 + `cursor`.
- Sem `any` no app; `console` só em `src/shared/logError.ts`; commits `tipo(escopo): mensagem` em pt-BR com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Fora do módulo importa-se só `@/modules/<ctx>`; exceção: `src/composition.ts` (ESLint `no-restricted-imports`).

## Review Focus

1. Token presente mas expirado, revogado ou PAT de dev fora do Dev → HTTP 401 (`error="invalid_token"`), nunca `isError` nem dados — testes nas Tasks 10 e 20.
2. JWT com `aud` em array contendo a URL do MCP é aceito; `aud` sem ela, `iss` errado ou expirado → recusado — Task 11.
3. `cursor` desconhecido ou de outro owner → página vazia (não reinicia do começo nem vaza dados) — Task 5.
4. `arguments` com `ownerId`/`tenantId` extras são ignorados; owner/tenant vêm do token — Tasks 17 e 20.
5. Tool chamada direto com flag desligada → `isError` sem executar; sem escopo → `FORBIDDEN` sem executar e auditado (se escrita) — Task 17. Config MCP ausente/HTTP fora do Dev → 500 genérico, sem crash no import — Tasks 16 e 18.

---

### Task 1: Dependências, novos erros e `Clock`

**Files:**
- Modify: `package.json` (deps)
- Modify: `src/shared/errors.ts`
- Create: `src/shared/kernel/Clock.ts`, `src/shared/kernel/index.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**
- Produces: `ForbiddenError(message?)` (403 `FORBIDDEN`), `RateLimitedError(message?)` (429 `RATE_LIMITED`); `interface Clock { now(): Date }`, `systemClock: Clock` exportados de `@/shared/kernel`.

- [ ] **Step 1: Instalar dependências**

Run: `npm i @modelcontextprotocol/sdk@^1.32.1 jose@^6.2.12 zod@^3.25.0 zod-to-json-schema@^3.25.0`
Expected: `package.json` com as 4 deps; `npm test` continua 25/25.

- [ ] **Step 2: Teste que falha**

```typescript
// tests/unit/errors.test.ts
import { describe, it, expect } from 'vitest'
import { ForbiddenError, RateLimitedError, AppError } from '@/shared/errors'

describe('erros funcionais novos', () => {
  it('ForbiddenError → 403 FORBIDDEN', () => {
    const e = new ForbiddenError()
    expect(e).toBeInstanceOf(AppError)
    expect([e.statusCode, e.code, e.message]).toEqual([403, 'FORBIDDEN', 'Acesso negado'])
  })

  it('RateLimitedError → 429 RATE_LIMITED', () => {
    const e = new RateLimitedError()
    expect([e.statusCode, e.code]).toEqual([429, 'RATE_LIMITED'])
  })
})
```

Run: `npx vitest run tests/unit/errors.test.ts`
Expected: FAIL (`ForbiddenError` não exportado).

- [ ] **Step 3: Implementar**

Acrescente ao fim de `src/shared/errors.ts`:

```typescript
export class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado') {
    super(message, 'FORBIDDEN', 403)
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Muitas requisições. Aguarde um instante e tente novamente.') {
    super(message, 'RATE_LIMITED', 429)
  }
}
```

```typescript
// src/shared/kernel/Clock.ts
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }
```

```typescript
// src/shared/kernel/index.ts
export { systemClock, type Clock } from './Clock'
```

- [ ] **Step 4: Rodar**

Run: `npx vitest run tests/unit/errors.test.ts && npm run type-check`
Expected: PASS; type-check sem erros.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/shared tests/unit/errors.test.ts
git commit -m "feat(skeleton): deps MCP/jose, ForbiddenError, RateLimitedError e Clock"
```

---

### Task 2: `AuthUser` e guards

**Files:**
- Create: `src/shared/auth/AuthUser.ts`, `src/shared/auth/guards.ts`, `src/shared/auth/index.ts`
- Create: `tests/helpers/makeActor.ts`, `tests/helpers/fixedClock.ts`
- Test: `tests/unit/guards.test.ts`

**Interfaces:**
- Consumes: `ForbiddenError` (Task 1), `Clock` (Task 1).
- Produces: `type AuthVia`, `interface AuthUser`, `type ResolveActor = (req: Request) => Promise<AuthUser>`; `requireScope(actor, scope): void`, `hasScope(actor, scope): boolean`, `assertOwnership(actor, ownerId): void` — todos via `@/shared/auth`. Helpers `makeActor(overrides?)` (padrão `{ id: 'user-1', tenantId: 'tenant-1', scopes: [], via: 'session' }`) e `fixedClock` (`2026-01-01T00:00:00Z`).

- [ ] **Step 1: Helpers e teste que falha**

```typescript
// tests/helpers/makeActor.ts
import type { AuthUser } from '@/shared/auth'

export function makeActor(overrides: Partial<AuthUser> = {}): AuthUser {
  return { id: 'user-1', tenantId: 'tenant-1', scopes: [], via: 'session', ...overrides }
}
```

```typescript
// tests/helpers/fixedClock.ts
import type { Clock } from '@/shared/kernel'

export const fixedClock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') }
```

```typescript
// tests/unit/guards.test.ts
import { describe, it, expect } from 'vitest'
import { requireScope, assertOwnership, hasScope } from '@/shared/auth'
import { ForbiddenError } from '@/shared/errors'
import { makeActor } from '../helpers/makeActor'

describe('requireScope', () => {
  it('lança ForbiddenError quando o escopo não está no actor', () => {
    expect(() => requireScope(makeActor(), 'resources:read')).toThrow(ForbiddenError)
  })

  it('passa quando o escopo está presente', () => {
    expect(() => requireScope(makeActor({ scopes: ['resources:read'] }), 'resources:read')).not.toThrow()
  })

  it('não aceita escopo parecido (prefixo)', () => {
    expect(hasScope(makeActor({ scopes: ['resources:readx'] }), 'resources:read')).toBe(false)
  })
})

describe('assertOwnership', () => {
  it('lança ForbiddenError quando o recurso é de outro usuário', () => {
    expect(() => assertOwnership(makeActor({ id: 'ana' }), 'bia')).toThrow(ForbiddenError)
  })

  it('passa para o próprio dono', () => {
    expect(() => assertOwnership(makeActor({ id: 'ana' }), 'ana')).not.toThrow()
  })
})
```

Run: `npx vitest run tests/unit/guards.test.ts`
Expected: FAIL (módulo `@/shared/auth` não existe).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/auth/AuthUser.ts
export type AuthVia = 'session' | 'oauth' | 'pat' | 'system'

export interface AuthUser {
  id: string
  tenantId: string
  scopes: string[]
  via: AuthVia
}

/** Borda → AuthUser; lança UnauthorizedError quando não há identidade válida. */
export type ResolveActor = (req: Request) => Promise<AuthUser>
```

```typescript
// src/shared/auth/guards.ts
import { ForbiddenError } from '@/shared/errors'
import type { AuthUser } from './AuthUser'

export function hasScope(actor: AuthUser, scope: string): boolean {
  return actor.scopes.includes(scope)
}

export function requireScope(actor: AuthUser, scope: string): void {
  if (!hasScope(actor, scope)) throw new ForbiddenError(`Permissão ausente: ${scope}`)
}

export function assertOwnership(actor: AuthUser, ownerId: string): void {
  if (actor.id !== ownerId) throw new ForbiddenError()
}
```

```typescript
// src/shared/auth/index.ts
export type { AuthUser, AuthVia, ResolveActor } from './AuthUser'
export { requireScope, hasScope, assertOwnership } from './guards'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/guards.test.ts && npm run type-check`
Expected: PASS (5 testes).

- [ ] **Step 4: Commit**

```bash
git add src/shared/auth tests/helpers tests/unit/guards.test.ts
git commit -m "feat(skeleton): AuthUser e guards requireScope/assertOwnership"
```

---

### Task 3: Feature flags nomeadas

**Files:**
- Modify: `src/shared/featureFlags.ts`
- Test: `tests/unit/featureFlags.test.ts` (estender)

**Interfaces:**
- Consumes: `NotFoundError`.
- Produces: `type FlagName = 'resources' | 'mcp.resources.read' | 'mcp.resources.write'`; `isEnabled(flag, env = process.env): boolean`; `ensureEnabled(flag, env = process.env): void` (lança `NotFoundError('Recurso')`). Valor `'on'` liga, `'off'` desliga, outro/ausente → padrão: `resources` off, `mcp.resources.read` **on**, `mcp.resources.write` off. Env: `RESOURCES_ENABLED`, `MCP_RESOURCES_READ`, `MCP_RESOURCES_WRITE`. `isResourcesEnabled` permanece até a Task 21.

- [ ] **Step 1: Teste que falha** — acrescente ao arquivo existente:

```typescript
import { isEnabled, ensureEnabled } from '@/shared/featureFlags'
import { NotFoundError } from '@/shared/errors'

describe('isEnabled', () => {
  it('mcp.resources.read nasce ligada', () => {
    expect(isEnabled('mcp.resources.read', {})).toBe(true)
  })
  it('mcp.resources.read pode ser desligada', () => {
    expect(isEnabled('mcp.resources.read', { MCP_RESOURCES_READ: 'off' })).toBe(false)
  })
  it('mcp.resources.write nasce desligada (fail-closed)', () => {
    expect(isEnabled('mcp.resources.write', {})).toBe(false)
    expect(isEnabled('mcp.resources.write', { MCP_RESOURCES_WRITE: 'yes' })).toBe(false)
  })
  it('mcp.resources.write liga só com on', () => {
    expect(isEnabled('mcp.resources.write', { MCP_RESOURCES_WRITE: 'on' })).toBe(true)
  })
  it('ensureEnabled lança NotFoundError quando desligada', () => {
    expect(() => ensureEnabled('resources', {})).toThrow(NotFoundError)
  })
})
```

Run: `npx vitest run tests/unit/featureFlags.test.ts`
Expected: FAIL (`isEnabled` não exportado).

- [ ] **Step 2: Implementar** — substitua `src/shared/featureFlags.ts`:

```typescript
import { NotFoundError } from '@/shared/errors'

type Env = Record<string, string | undefined>

const FLAGS = {
  resources: { envVar: 'RESOURCES_ENABLED', defaultOn: false },
  'mcp.resources.read': { envVar: 'MCP_RESOURCES_READ', defaultOn: true },
  'mcp.resources.write': { envVar: 'MCP_RESOURCES_WRITE', defaultOn: false },
} as const

export type FlagName = keyof typeof FLAGS

export function isEnabled(flag: FlagName, env: Env = process.env): boolean {
  const { envVar, defaultOn } = FLAGS[flag]
  const value = env[envVar]
  if (value === 'on') return true
  if (value === 'off') return false
  return defaultOn
}

export function ensureEnabled(flag: FlagName, env: Env = process.env): void {
  if (!isEnabled(flag, env)) throw new NotFoundError('Recurso')
}

/** @deprecated use isEnabled('resources'); removido quando a página migrar. */
export function isResourcesEnabled(env: Env = process.env): boolean {
  return isEnabled('resources', env)
}
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/featureFlags.test.ts && npm run type-check`
Expected: PASS (3 antigos + 5 novos).

- [ ] **Step 4: Commit**

```bash
git add src/shared/featureFlags.ts tests/unit/featureFlags.test.ts
git commit -m "feat(skeleton): flags nomeadas com padrão por flag (escrita MCP desligada)"
```

---
### Task 4: Value Objects e aggregate `Resource`

**Files:**
- Create: `src/shared/kernel/AggregateRoot.ts` (e exportar em `src/shared/kernel/index.ts`)
- Create: `src/modules/resources/domain/Title.ts`, `src/modules/resources/domain/ResourceId.ts`, `src/modules/resources/domain/Resource.ts`
- Test: `tests/unit/Title.test.ts`, `tests/unit/Resource.test.ts` (substitui o teste da entidade antiga)

**Interfaces:**
- Consumes: `DomainError`, `Clock`.
- Produces: `TITLE_RULE = 'Título deve ter de 3 a 100 caracteres'`; `Title.of(raw): Title` (`.value`, trim, 3–100); `ResourceId.new()`, `ResourceId.of(raw)` (UUID; senão `DomainError('Identificador inválido')`), `.value`; `Resource.create({ tenantId, ownerId, title: Title }, clock)`, `Resource.rehydrate(snapshot)`, `resource.toSnapshot(): ResourceSnapshot`; `ResourceSnapshot = { id, tenantId, ownerId, title, createdAt: Date }`. Imports internos do módulo são **relativos** (a regra de ESLint da Task 22 proíbe `@/modules/<ctx>/<interno>` em `src/`).

- [ ] **Step 1: Testes que falham**

```typescript
// tests/unit/Title.test.ts
import { describe, it, expect } from 'vitest'
import { Title } from '@/modules/resources/domain/Title'
import { DomainError } from '@/shared/errors'

describe('Title', () => {
  it('rejeita título com menos de 3 caracteres', () => {
    expect(() => Title.of('ab')).toThrow(DomainError)
  })
  it('rejeita título com mais de 100 caracteres', () => {
    expect(() => Title.of('x'.repeat(101))).toThrow('Título deve ter de 3 a 100 caracteres')
  })
  it('conta o tamanho depois do trim', () => {
    expect(() => Title.of('  ab  ')).toThrow(DomainError)
  })
  it('normaliza espaços nas pontas', () => {
    expect(Title.of('  Meu recurso  ').value).toBe('Meu recurso')
  })
})
```

```typescript
// tests/unit/Resource.test.ts
import { describe, it, expect } from 'vitest'
import { Resource } from '@/modules/resources/domain/Resource'
import { ResourceId } from '@/modules/resources/domain/ResourceId'
import { Title } from '@/modules/resources/domain/Title'
import { DomainError } from '@/shared/errors'
import { fixedClock } from '../helpers/fixedClock'

describe('Resource', () => {
  it('create gera id UUID e usa o relógio injetado', () => {
    const r = Resource.create({ tenantId: 't1', ownerId: 'ana', title: Title.of('Novo') }, fixedClock)
    expect(r.id.value).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(r.title.value).toBe('Novo')
  })

  it('rehydrate ∘ toSnapshot preserva os dados', () => {
    const r = Resource.create({ tenantId: 't1', ownerId: 'ana', title: Title.of('Novo') }, fixedClock)
    expect(Resource.rehydrate(r.toSnapshot()).toSnapshot()).toEqual(r.toSnapshot())
  })

  it('rehydrate revalida as invariantes (título inválido no banco → DomainError)', () => {
    const snap = { ...Resource.create({ tenantId: 't1', ownerId: 'ana', title: Title.of('Novo') }, fixedClock).toSnapshot(), title: 'x' }
    expect(() => Resource.rehydrate(snap)).toThrow(DomainError)
  })

  it('ResourceId.of rejeita valor que não é UUID', () => {
    expect(() => ResourceId.of('nao-uuid')).toThrow(DomainError)
  })
})
```

Run: `npx vitest run tests/unit/Title.test.ts tests/unit/Resource.test.ts`
Expected: FAIL (módulos `@/modules/resources/domain/*` não existem).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/kernel/AggregateRoot.ts
/**
 * Raiz de agregado: único ponto de entrada para mudar o estado do agregado.
 * Domain events entram aqui só quando houver um consumidor real (ADR-011).
 */
export abstract class AggregateRoot {}
```

`src/shared/kernel/index.ts` passa a ser:

```typescript
export { systemClock, type Clock } from './Clock'
export { AggregateRoot } from './AggregateRoot'
```

```typescript
// src/modules/resources/domain/Title.ts
import { DomainError } from '@/shared/errors'

export const TITLE_RULE = 'Título deve ter de 3 a 100 caracteres'

export class Title {
  private constructor(readonly value: string) {}

  static of(raw: string): Title {
    const value = raw.trim()
    if (value.length < 3 || value.length > 100) throw new DomainError(TITLE_RULE)
    return new Title(value)
  }
}
```

```typescript
// src/modules/resources/domain/ResourceId.ts
import { DomainError } from '@/shared/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class ResourceId {
  private constructor(readonly value: string) {}

  static new(): ResourceId {
    return new ResourceId(crypto.randomUUID())
  }

  static of(raw: string): ResourceId {
    if (!UUID.test(raw)) throw new DomainError('Identificador inválido')
    return new ResourceId(raw)
  }
}
```

```typescript
// src/modules/resources/domain/Resource.ts
import { AggregateRoot, type Clock } from '@/shared/kernel'
import { ResourceId } from './ResourceId'
import { Title } from './Title'

export interface ResourceSnapshot {
  id: string
  tenantId: string
  ownerId: string
  title: string
  createdAt: Date
}

export class Resource extends AggregateRoot {
  private constructor(
    readonly id: ResourceId,
    readonly tenantId: string,
    readonly ownerId: string,
    readonly title: Title,
    readonly createdAt: Date
  ) {
    super()
  }

  static create(props: { tenantId: string; ownerId: string; title: Title }, clock: Clock): Resource {
    return new Resource(ResourceId.new(), props.tenantId, props.ownerId, props.title, clock.now())
  }

  static rehydrate(s: ResourceSnapshot): Resource {
    return new Resource(ResourceId.of(s.id), s.tenantId, s.ownerId, Title.of(s.title), new Date(s.createdAt))
  }

  toSnapshot(): ResourceSnapshot {
    return {
      id: this.id.value,
      tenantId: this.tenantId,
      ownerId: this.ownerId,
      title: this.title.value,
      createdAt: new Date(this.createdAt),
    }
  }
}
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/Title.test.ts tests/unit/Resource.test.ts && npm run type-check`
Expected: PASS (8 testes). O type-check ainda compila o código antigo (`src/domain/...`), que continua intacto.

- [ ] **Step 4: Commit**

```bash
git add src/shared/kernel src/modules tests/unit/Title.test.ts tests/unit/Resource.test.ts
git commit -m "feat(resources): value objects Title/ResourceId e aggregate Resource"
```

---

### Task 5: `IResourceRepository` e repositório in-memory paginado

**Files:**
- Create: `src/modules/resources/domain/IResourceRepository.ts`
- Create: `src/modules/resources/infrastructure/InMemoryResourceRepository.ts`
- Test: `tests/unit/InMemoryResourceRepository.test.ts` (substitui o antigo)

**Interfaces:**
- Consumes: `Resource`, `Title`, `systemClock` (Task 4/1).
- Produces: `interface IResourceRepository { save(r): Promise<void>; findByOwner(tenantId, ownerId, page: { limit: number; cursor?: string }): Promise<Resource[]> }`. `InMemoryResourceRepository` implementa e acrescenta `clear(): void` e `seed(items: { ownerId; tenantId; title }[]): void`. Ordem = inserção; `cursor` = `id` do último item da página anterior; cursor desconhecido (ou de outro owner/tenant) → `[]`.

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/InMemoryResourceRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'

describe('InMemoryResourceRepository', () => {
  let repo: InMemoryResourceRepository

  beforeEach(() => {
    repo = new InMemoryResourceRepository()
    repo.seed([
      { ownerId: 'ana', tenantId: 't1', title: 'A1' },
      { ownerId: 'bia', tenantId: 't1', title: 'B1' },
      { ownerId: 'ana', tenantId: 't1', title: 'A2' },
      { ownerId: 'ana', tenantId: 't2', title: 'Outro tenant' },
      { ownerId: 'ana', tenantId: 't1', title: 'A3' },
    ])
  })

  const titles = (rs: { title: { value: string } }[]) => rs.map((r) => r.title.value)

  it('filtra por tenant E owner', async () => {
    expect(titles(await repo.findByOwner('t1', 'ana', { limit: 50 }))).toEqual(['A1', 'A2', 'A3'])
  })

  it('respeita limit e continua do cursor', async () => {
    const first = await repo.findByOwner('t1', 'ana', { limit: 2 })
    expect(titles(first)).toEqual(['A1', 'A2'])
    const next = await repo.findByOwner('t1', 'ana', { limit: 2, cursor: first[1].id.value })
    expect(titles(next)).toEqual(['A3'])
  })

  it('cursor desconhecido → página vazia (não reinicia)', async () => {
    expect(await repo.findByOwner('t1', 'ana', { limit: 2, cursor: 'nao-existe' })).toEqual([])
  })

  it('cursor de outro owner → página vazia (não vaza)', async () => {
    const [bia] = await repo.findByOwner('t1', 'bia', { limit: 1 })
    expect(await repo.findByOwner('t1', 'ana', { limit: 2, cursor: bia.id.value })).toEqual([])
  })

  it('clear esvazia o repositório', async () => {
    repo.clear()
    expect(await repo.findByOwner('t1', 'ana', { limit: 50 })).toEqual([])
  })
})
```

Run: `npx vitest run tests/unit/InMemoryResourceRepository.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 2: Implementar**

```typescript
// src/modules/resources/domain/IResourceRepository.ts
import type { Resource } from './Resource'

export interface PageRequest {
  limit: number
  cursor?: string
}

export interface IResourceRepository {
  save(resource: Resource): Promise<void>
  /** Itens do owner no tenant, na ordem de criação; `cursor` = id do último item já visto. */
  findByOwner(tenantId: string, ownerId: string, page: PageRequest): Promise<Resource[]>
}
```

```typescript
// src/modules/resources/infrastructure/InMemoryResourceRepository.ts
import { systemClock } from '@/shared/kernel'
import type { IResourceRepository, PageRequest } from '../domain/IResourceRepository'
import { Resource, type ResourceSnapshot } from '../domain/Resource'
import { Title } from '../domain/Title'

export class InMemoryResourceRepository implements IResourceRepository {
  private store = new Map<string, ResourceSnapshot>()

  async save(resource: Resource): Promise<void> {
    this.store.set(resource.id.value, resource.toSnapshot())
  }

  async findByOwner(tenantId: string, ownerId: string, page: PageRequest): Promise<Resource[]> {
    const owned = [...this.store.values()].filter(
      (s) => s.tenantId === tenantId && s.ownerId === ownerId
    )
    let start = 0
    if (page.cursor !== undefined) {
      const index = owned.findIndex((s) => s.id === page.cursor)
      if (index === -1) return []
      start = index + 1
    }
    return owned.slice(start, start + page.limit).map((s) => Resource.rehydrate(s))
  }

  clear(): void {
    this.store.clear()
  }

  /** Dados de exemplo para Dev e testes. */
  seed(items: { ownerId: string; tenantId: string; title: string }[]): void {
    for (const item of items) {
      const resource = Resource.create(
        { tenantId: item.tenantId, ownerId: item.ownerId, title: Title.of(item.title) },
        systemClock
      )
      this.store.set(resource.id.value, resource.toSnapshot())
    }
  }
}
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/InMemoryResourceRepository.test.ts && npm run type-check`
Expected: PASS (5 testes).

- [ ] **Step 4: Commit**

```bash
git add src/modules tests/unit/InMemoryResourceRepository.test.ts
git commit -m "feat(resources): IResourceRepository e repositório in-memory com cursor"
```

---

### Task 6: Schemas Zod, DTO e `index.ts` do módulo

**Files:**
- Create: `src/modules/resources/application/schemas.ts`, `src/modules/resources/application/dto.ts`, `src/modules/resources/index.ts`
- Test: `tests/unit/resourceSchemas.test.ts` (reescrever), `tests/unit/resourceDto.test.ts`

**Interfaces:**
- Consumes: `Resource`, `TITLE_RULE` (Task 4).
- Produces (via `@/modules/resources`): `createResourceSchema`, `listResourcesSchema`, `CreateResourceInput`, `ListResourcesInput` (tipo de **saída** do schema: `limit` sempre número); `resourceDTOSchema`, `ResourceDTO`, `resourcePageSchema`, `ResourcePage = { items: ResourceDTO[]; nextCursor: string | null }`, `toResourceDTO(resource)`, `toResourcePage(items, limit)` (`nextCursor` = id do último item quando a página veio cheia; senão `null`).

- [ ] **Step 1: Testes que falham**

```typescript
// tests/unit/resourceSchemas.test.ts
import { describe, it, expect } from 'vitest'
import { createResourceSchema, listResourcesSchema } from '@/modules/resources'

describe('createResourceSchema', () => {
  it('aceita título válido e faz trim', () => {
    expect(createResourceSchema.parse({ title: '  Válido  ' })).toEqual({ title: 'Válido' })
  })
  it('rejeita título curto com a mensagem do domínio', () => {
    const r = createResourceSchema.safeParse({ title: 'ab' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Título deve ter de 3 a 100 caracteres')
  })
  it('descarta campos extras como ownerId', () => {
    expect(createResourceSchema.parse({ title: 'Válido', ownerId: 'bia' })).toEqual({ title: 'Válido' })
  })
})

describe('listResourcesSchema', () => {
  it('usa limit 20 por padrão', () => {
    expect(listResourcesSchema.parse({})).toEqual({ limit: 20 })
  })
  it('limita a página a 50 itens', () => {
    expect(listResourcesSchema.safeParse({ limit: 51 }).success).toBe(false)
  })
  it('rejeita limit não inteiro ou menor que 1', () => {
    expect(listResourcesSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(listResourcesSchema.safeParse({ limit: 1.5 }).success).toBe(false)
  })
})
```

```typescript
// tests/unit/resourceDto.test.ts
import { describe, it, expect } from 'vitest'
import { toResourceDTO, toResourcePage, resourceDTOSchema } from '@/modules/resources'
import { Resource } from '@/modules/resources/domain/Resource'
import { Title } from '@/modules/resources/domain/Title'
import { fixedClock } from '../helpers/fixedClock'

const make = (title: string) =>
  toResourceDTO(Resource.create({ tenantId: 't1', ownerId: 'ana', title: Title.of(title) }, fixedClock))

describe('toResourceDTO', () => {
  it('expõe só id, title, ownerId e createdAt ISO (sem tenantId)', () => {
    const dto = make('Novo')
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'id', 'ownerId', 'title'])
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(resourceDTOSchema.parse(dto)).toEqual(dto)
  })
})

describe('toResourcePage', () => {
  it('página cheia → nextCursor = id do último', () => {
    const items = [make('Um1'), make('Dois')]
    expect(toResourcePage(items, 2).nextCursor).toBe(items[1].id)
  })
  it('página incompleta → nextCursor null', () => {
    expect(toResourcePage([make('Um1')], 2).nextCursor).toBeNull()
  })
})
```

Run: `npx vitest run tests/unit/resourceSchemas.test.ts tests/unit/resourceDto.test.ts`
Expected: FAIL (`@/modules/resources` não existe).

- [ ] **Step 2: Implementar**

```typescript
// src/modules/resources/application/schemas.ts
import { z } from 'zod'
import { TITLE_RULE } from '../domain/Title'

export const createResourceSchema = z.object({
  title: z.string().trim().min(3, TITLE_RULE).max(100, TITLE_RULE).describe('Título do recurso'),
})

export const listResourcesSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20).describe('Quantidade máxima (≤ 50)'),
  cursor: z.string().optional().describe('Cursor devolvido pela página anterior (nextCursor)'),
})

export type CreateResourceInput = z.infer<typeof createResourceSchema>
export type ListResourcesInput = z.infer<typeof listResourcesSchema>
```

```typescript
// src/modules/resources/application/dto.ts
import { z } from 'zod'
import type { Resource } from '../domain/Resource'

export const resourceDTOSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerId: z.string(),
  createdAt: z.string().datetime(),
})
export type ResourceDTO = z.infer<typeof resourceDTOSchema>

export const resourcePageSchema = z.object({
  items: z.array(resourceDTOSchema),
  nextCursor: z.string().nullable(),
})
export type ResourcePage = z.infer<typeof resourcePageSchema>

export function toResourceDTO(resource: Resource): ResourceDTO {
  return {
    id: resource.id.value,
    title: resource.title.value,
    ownerId: resource.ownerId,
    createdAt: resource.createdAt.toISOString(),
  }
}

export function toResourcePage(items: ResourceDTO[], limit: number): ResourcePage {
  const isFull = items.length === limit && items.length > 0
  return { items, nextCursor: isFull ? items[items.length - 1].id : null }
}
```

```typescript
// src/modules/resources/index.ts
export {
  createResourceSchema,
  listResourcesSchema,
  type CreateResourceInput,
  type ListResourcesInput,
} from './application/schemas'
export {
  resourceDTOSchema,
  resourcePageSchema,
  toResourceDTO,
  toResourcePage,
  type ResourceDTO,
  type ResourcePage,
} from './application/dto'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/resourceSchemas.test.ts tests/unit/resourceDto.test.ts && npm run type-check`
Expected: PASS (9 testes).

- [ ] **Step 4: Commit**

```bash
git add src/modules tests/unit/resourceSchemas.test.ts tests/unit/resourceDto.test.ts
git commit -m "feat(resources): schemas Zod, DTO paginado e index do módulo"
```

---

### Task 7: `ResourceService`

**Files:**
- Create: `src/modules/resources/application/ResourceService.ts`
- Modify: `src/modules/resources/index.ts` (exportar `ResourceService`)
- Test: `tests/unit/ResourceService.test.ts`

**Interfaces:**
- Consumes: `IResourceRepository` (Task 5), schemas/DTO (Task 6), `requireScope` (Task 2), `Clock`.
- Produces: `new ResourceService(repo: IResourceRepository, clock: Clock)`; `list(actor, input: ListResourcesInput): Promise<ResourceDTO[]>` (escopo `resources:read`); `create(actor, input: CreateResourceInput): Promise<ResourceDTO>` (escopo `resources:write`; tenant/owner do actor).

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/ResourceService.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResourceService } from '@/modules/resources'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'
import { ForbiddenError, DomainError } from '@/shared/errors'
import { makeActor } from '../helpers/makeActor'
import { fixedClock } from '../helpers/fixedClock'

describe('ResourceService', () => {
  let repo: InMemoryResourceRepository
  let service: ResourceService
  const write = ['resources:write']
  const read = ['resources:read']

  beforeEach(() => {
    repo = new InMemoryResourceRepository()
    service = new ResourceService(repo, fixedClock)
  })

  it('cria o recurso com owner e tenant derivados do actor', async () => {
    const dto = await service.create(makeActor({ scopes: write }), { title: 'Novo' })
    expect(dto).toMatchObject({ title: 'Novo', ownerId: 'user-1' })
    const [saved] = await repo.findByOwner('tenant-1', 'user-1', { limit: 1 })
    expect(saved.tenantId).toBe('tenant-1')
  })

  it('sem escopo de escrita → ForbiddenError e NÃO salva', async () => {
    const saveSpy = vi.spyOn(repo, 'save')
    await expect(service.create(makeActor({ scopes: read }), { title: 'Novo' })).rejects.toThrow(ForbiddenError)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('título inválido → DomainError e NÃO salva', async () => {
    const saveSpy = vi.spyOn(repo, 'save')
    await expect(service.create(makeActor({ scopes: write }), { title: 'ab' })).rejects.toThrow(DomainError)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('list sem escopo de leitura → ForbiddenError e NÃO consulta', async () => {
    const findSpy = vi.spyOn(repo, 'findByOwner')
    await expect(service.list(makeActor({ scopes: write }), { limit: 20 })).rejects.toThrow(ForbiddenError)
    expect(findSpy).not.toHaveBeenCalled()
  })

  it('list devolve só os recursos do próprio actor', async () => {
    await service.create(makeActor({ id: 'ana', scopes: write }), { title: 'Da Ana' })
    await service.create(makeActor({ id: 'bia', scopes: write }), { title: 'Da Bia' })
    const result = await service.list(makeActor({ id: 'ana', scopes: read }), { limit: 20 })
    expect(result.map((r) => r.title)).toEqual(['Da Ana'])
  })

  it('list isola por tenant (mesmo id de usuário em outro tenant)', async () => {
    await service.create(makeActor({ id: 'ana', tenantId: 't2', scopes: write }), { title: 'Outro tenant' })
    expect(await service.list(makeActor({ id: 'ana', scopes: read }), { limit: 20 })).toEqual([])
  })

  it('o DTO não vaza campos internos (ex.: tenantId)', async () => {
    const dto = await service.create(makeActor({ scopes: write }), { title: 'Novo' })
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'id', 'ownerId', 'title'])
  })
})
```

Run: `npx vitest run tests/unit/ResourceService.test.ts`
Expected: FAIL (`ResourceService` não exportado).

- [ ] **Step 2: Implementar**

```typescript
// src/modules/resources/application/ResourceService.ts
import { requireScope, type AuthUser } from '@/shared/auth'
import type { Clock } from '@/shared/kernel'
import type { IResourceRepository } from '../domain/IResourceRepository'
import { Resource } from '../domain/Resource'
import { Title } from '../domain/Title'
import { toResourceDTO, type ResourceDTO } from './dto'
import type { CreateResourceInput, ListResourcesInput } from './schemas'

export class ResourceService {
  constructor(
    private readonly repo: IResourceRepository,
    private readonly clock: Clock
  ) {}

  async list(actor: AuthUser, input: ListResourcesInput): Promise<ResourceDTO[]> {
    requireScope(actor, 'resources:read')
    const items = await this.repo.findByOwner(actor.tenantId, actor.id, input)
    return items.map(toResourceDTO)
  }

  async create(actor: AuthUser, input: CreateResourceInput): Promise<ResourceDTO> {
    requireScope(actor, 'resources:write')
    const resource = Resource.create(
      { tenantId: actor.tenantId, ownerId: actor.id, title: Title.of(input.title) },
      this.clock
    )
    await this.repo.save(resource)
    return toResourceDTO(resource)
  }
}
```

Acrescente ao `src/modules/resources/index.ts`:

```typescript
export { ResourceService } from './application/ResourceService'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/ResourceService.test.ts && npm run type-check`
Expected: PASS (7 testes).

- [ ] **Step 4: Commit**

```bash
git add src/modules tests/unit/ResourceService.test.ts
git commit -m "feat(resources): ResourceService com actor primeiro e guards de escopo"
```

---
### Task 8: Sessão web → `AuthUser` (stub só no Dev)

**Files:**
- Create: `src/shared/appEnv.ts`
- Create: `src/shared/auth/session.ts` (exportar em `src/shared/auth/index.ts`)
- Test: `tests/unit/session.test.ts`

**Interfaces:**
- Consumes: `AuthUser`, `ResolveActor` (Task 2), `UnauthorizedError`.
- Produces: `isDevEnvironment(env = process.env): boolean` (`APP_ENV === 'development'`); `interface IAuthProvider { getUser(req: Request): Promise<AuthUser | null> }`; `StubAuthProvider` (devolve `{ id: 'dev-user', tenantId: 'dev-tenant', scopes: ['resources:read', 'resources:write'], via: 'session' }` **só** com `APP_ENV=development`, lido a cada requisição; senão `null`); `makeSessionResolver(provider): ResolveActor` (`null` → `UnauthorizedError`).

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/session.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { StubAuthProvider, makeSessionResolver } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'

const req = new Request('http://localhost/api/resources')
const resolve = makeSessionResolver(new StubAuthProvider())

describe('StubAuthProvider + makeSessionResolver', () => {
  afterEach(() => {
    delete process.env.APP_ENV
  })

  it('no Dev local resolve o dev-user com escopos de resources', async () => {
    process.env.APP_ENV = 'development'
    expect(await resolve(req)).toEqual({
      id: 'dev-user',
      tenantId: 'dev-tenant',
      scopes: ['resources:read', 'resources:write'],
      via: 'session',
    })
  })

  it('fora do Dev (APP_ENV ausente) → UnauthorizedError (stub nunca vale em UAT/Prod)', async () => {
    await expect(resolve(req)).rejects.toThrow(UnauthorizedError)
  })

  it('APP_ENV=uat → UnauthorizedError', async () => {
    process.env.APP_ENV = 'uat'
    await expect(resolve(req)).rejects.toThrow(UnauthorizedError)
  })
})
```

Run: `npx vitest run tests/unit/session.test.ts`
Expected: FAIL (`StubAuthProvider` não exportado por `@/shared/auth`).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/appEnv.ts
type Env = Record<string, string | undefined>

/** Dev local só quando declarado explicitamente; ausente = não é Dev (fail-closed). */
export function isDevEnvironment(env: Env = process.env): boolean {
  return env.APP_ENV === 'development'
}
```

```typescript
// src/shared/auth/session.ts
import { isDevEnvironment } from '@/shared/appEnv'
import { UnauthorizedError } from '@/shared/errors'
import type { AuthUser, ResolveActor } from './AuthUser'

/** Login/sessão web (ex.: Auth0 Universal Login + cookie) → AuthUser. */
export interface IAuthProvider {
  getUser(req: Request): Promise<AuthUser | null>
}

/** Sessão fake para o Dev local. Fora do Dev não autentica ninguém. */
export class StubAuthProvider implements IAuthProvider {
  async getUser(_req: Request): Promise<AuthUser | null> {
    if (!isDevEnvironment()) return null
    return {
      id: 'dev-user',
      tenantId: 'dev-tenant',
      scopes: ['resources:read', 'resources:write'],
      via: 'session',
    }
  }
}

export function makeSessionResolver(provider: IAuthProvider): ResolveActor {
  return async (req) => {
    const user = await provider.getUser(req)
    if (!user) throw new UnauthorizedError()
    return user
  }
}
```

Acrescente ao `src/shared/auth/index.ts`:

```typescript
export { StubAuthProvider, makeSessionResolver, type IAuthProvider } from './session'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/session.test.ts && npm run type-check`
Expected: PASS (3 testes).

- [ ] **Step 4: Commit**

```bash
git add src/shared tests/unit/session.test.ts
git commit -m "feat(auth): sessão stub vira AuthUser com escopos, só no Dev local"
```

---

### Task 9: Handlers REST, `composition.ts` e rota `/api/resources`

**Files:**
- Create: `src/modules/resources/interfaces/http/handlers.ts` (exportar `makeResourceHandlers` no `index.ts`)
- Create: `src/composition.ts`
- Modify: `src/app/api/resources/route.ts` (substituir)
- Test: `tests/integration/resources.route.test.ts` (reescrever)

**Interfaces:**
- Consumes: `ResourceService` (Task 7), `listResourcesSchema`/`createResourceSchema` (Task 6), `ensureEnabled` (Task 3), `ResolveActor`/`StubAuthProvider`/`makeSessionResolver` (Tasks 2/8), `handleApiError`.
- Produces: `makeResourceHandlers(service, resolveActor) → { GET(req), POST(req) }`; `@/composition` exporta `resourceRepository` (o `InMemoryResourceRepository` real) e `resourceHandlers`. GET lê `?limit=&cursor=` da query.

- [ ] **Step 1: Teste que falha** — substitua o arquivo inteiro:

```typescript
// tests/integration/resources.route.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GET, POST } from '@/app/api/resources/route'
import { resourceRepository } from '@/composition'

const postReq = (body: unknown) =>
  new Request('http://localhost/api/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

afterEach(() => {
  delete process.env.RESOURCES_ENABLED
  delete process.env.APP_ENV
  vi.restoreAllMocks()
})

describe('rota /api/resources (flag on, Dev local)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'on'
    process.env.APP_ENV = 'development'
    resourceRepository.clear()
  })

  it('POST com título válido → 201 e owner = usuário da sessão', async () => {
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(201)
    expect((await res.json()).ownerId).toBe('dev-user')
  })

  it('POST com título inválido → 400 VALIDATION_ERROR', async () => {
    const res = await POST(postReq({ title: 'ab' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('VALIDATION_ERROR')
  })

  it('POST ignora ownerId do corpo (owner vem da sessão)', async () => {
    const res = await POST(postReq({ title: 'Válido', ownerId: 'bia' }))
    expect((await res.json()).ownerId).toBe('dev-user')
  })

  it('GET lista o que foi criado', async () => {
    await POST(postReq({ title: 'Válido' }))
    const res = await GET(new Request('http://localhost/api/resources'))
    expect((await res.json()).map((r: { title: string }) => r.title)).toEqual(['Válido'])
  })

  it('GET respeita ?limit= e rejeita limit > 50', async () => {
    await POST(postReq({ title: 'Um1' }))
    await POST(postReq({ title: 'Dois' }))
    const page = await GET(new Request('http://localhost/api/resources?limit=1'))
    expect(await page.json()).toHaveLength(1)
    const bad = await GET(new Request('http://localhost/api/resources?limit=51'))
    expect(bad.status).toBe(400)
  })
})

describe('rota /api/resources (fora do Dev)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'on'
    resourceRepository.clear()
  })

  it('sem sessão real → 401 UNAUTHORIZED e NÃO persiste', async () => {
    const saveSpy = vi.spyOn(resourceRepository, 'save')
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('UNAUTHORIZED')
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('rota /api/resources (flag off)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'off'
    process.env.APP_ENV = 'development'
    resourceRepository.clear()
  })

  it('POST → 404 quando desligado e NÃO persiste', async () => {
    const saveSpy = vi.spyOn(resourceRepository, 'save')
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(404)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('GET → 404 quando desligado', async () => {
    expect((await GET(new Request('http://localhost/api/resources'))).status).toBe(404)
  })
})
```

Run: `npx vitest run tests/integration/resources.route.test.ts`
Expected: FAIL (`@/composition` não existe).

- [ ] **Step 2: Implementar**

```typescript
// src/modules/resources/interfaces/http/handlers.ts
import type { ResolveActor } from '@/shared/auth'
import { ensureEnabled } from '@/shared/featureFlags'
import { handleApiError } from '@/shared/handleApiError'
import type { ResourceService } from '../../application/ResourceService'
import { createResourceSchema, listResourcesSchema } from '../../application/schemas'

function listInputFrom(url: string): unknown {
  const params = new URL(url).searchParams
  const limit = params.get('limit')
  return {
    limit: limit === null ? undefined : Number(limit),
    cursor: params.get('cursor') ?? undefined,
  }
}

export const makeResourceHandlers = (service: ResourceService, resolveActor: ResolveActor) => ({
  async GET(req: Request): Promise<Response> {
    try {
      ensureEnabled('resources')
      const actor = await resolveActor(req)
      const input = listResourcesSchema.parse(listInputFrom(req.url))
      return Response.json(await service.list(actor, input))
    } catch (error) {
      return handleApiError(error, 'api/resources:GET')
    }
  },

  async POST(req: Request): Promise<Response> {
    try {
      ensureEnabled('resources')
      const actor = await resolveActor(req)
      const input = createResourceSchema.parse(await req.json())
      return Response.json(await service.create(actor, input), { status: 201 })
    } catch (error) {
      return handleApiError(error, 'api/resources:POST')
    }
  },
})
```

Acrescente ao `src/modules/resources/index.ts`:

```typescript
export { makeResourceHandlers } from './interfaces/http/handlers'
```

```typescript
// src/composition.ts
// Único arquivo que importa infrastructure/: instancia repositórios, services e bordas.
import { ResourceService, makeResourceHandlers } from '@/modules/resources'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'
import { StubAuthProvider, makeSessionResolver } from '@/shared/auth'
import { systemClock } from '@/shared/kernel'

export const resourceRepository = new InMemoryResourceRepository()
const resourceService = new ResourceService(resourceRepository, systemClock)

const resolveSessionActor = makeSessionResolver(new StubAuthProvider())

export const resourceHandlers = makeResourceHandlers(resourceService, resolveSessionActor)
```

```typescript
// src/app/api/resources/route.ts
import { resourceHandlers } from '@/composition'

export const { GET, POST } = resourceHandlers
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/integration/resources.route.test.ts && npm run type-check`
Expected: PASS (8 testes). O código antigo (`src/infrastructure/composition.ts`, use cases) fica órfão até a Task 21.

- [ ] **Step 4: Commit**

```bash
git add src/modules src/composition.ts src/app/api/resources/route.ts tests/integration/resources.route.test.ts
git commit -m "feat(resources): handlers REST finos montados em composition.ts"
```

---

### Task 10: Tokens pessoais (PAT) e `PersonalTokenVerifier`

**Files:**
- Create: `src/shared/auth/IAccessTokenVerifier.ts`, `src/shared/auth/personalTokens.ts` (exportar no `index.ts`)
- Test: `tests/unit/personalTokens.test.ts`

**Interfaces:**
- Consumes: `AuthUser`, `UnauthorizedError`, `Clock`/`systemClock`, `isDevEnvironment` (Task 8).
- Produces: `interface IAccessTokenVerifier { verify(token: string): Promise<AuthUser> }` (lança `UnauthorizedError` quando inválido); `PAT_PREFIX = 'pat_'`; `hashToken(token): string` (SHA-256 hex); `InMemoryPersonalTokenStore(clock = systemClock)` com `issue({ userId, tenantId, scopes, expiresAt?, token?, devOnly? }): Promise<string>` (token bruto devolvido uma vez; guarda só o hash; validade padrão 90 dias), `revoke(token): Promise<void>`, `findByHash(hash)`, `touch(id, at)`, `clear()`; `PersonalTokenVerifier(store, clock = systemClock)` → `AuthUser` com `via: 'pat'` e atualiza `lastUsedAt`. `devOnly` só vale com `APP_ENV=development`.

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/personalTokens.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { InMemoryPersonalTokenStore, PersonalTokenVerifier, hashToken } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'
import type { Clock } from '@/shared/kernel'

let now = new Date('2026-01-01T00:00:00Z')
const clock: Clock = { now: () => now }
const owner = { userId: 'ana', tenantId: 't1', scopes: ['resources:read'] }

describe('PersonalTokenVerifier', () => {
  let store: InMemoryPersonalTokenStore
  let verifier: PersonalTokenVerifier

  beforeEach(() => {
    now = new Date('2026-01-01T00:00:00Z')
    store = new InMemoryPersonalTokenStore(clock)
    verifier = new PersonalTokenVerifier(store, clock)
  })
  afterEach(() => {
    delete process.env.APP_ENV
  })

  it('emite pat_… e guarda só o hash SHA-256', async () => {
    const token = await store.issue(owner)
    expect(token).toMatch(/^pat_[A-Za-z0-9_-]{32,}$/)
    const record = await store.findByHash(hashToken(token))
    expect(record?.tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(record)).not.toContain(token)
  })

  it('token válido → AuthUser via pat e marca lastUsedAt', async () => {
    const token = await store.issue(owner)
    expect(await verifier.verify(token)).toEqual({ id: 'ana', tenantId: 't1', scopes: ['resources:read'], via: 'pat' })
    expect((await store.findByHash(hashToken(token)))?.lastUsedAt).toEqual(now)
  })

  it('token desconhecido → UnauthorizedError', async () => {
    await expect(verifier.verify('pat_nao_existe_nao_existe_nao_existe')).rejects.toThrow(UnauthorizedError)
  })

  it('token expirado → UnauthorizedError', async () => {
    const token = await store.issue({ ...owner, expiresAt: new Date('2026-01-02T00:00:00Z') })
    now = new Date('2026-01-02T00:00:00Z')
    await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedError)
  })

  it('validade padrão de 90 dias', async () => {
    const token = await store.issue(owner)
    expect((await store.findByHash(hashToken(token)))?.expiresAt).toEqual(new Date('2026-04-01T00:00:00Z'))
  })

  it('token revogado → UnauthorizedError', async () => {
    const token = await store.issue(owner)
    await store.revoke(token)
    await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedError)
  })

  it('token devOnly só vale com APP_ENV=development', async () => {
    const token = await store.issue({ ...owner, devOnly: true, token: 'pat_dev_local_dev_local_dev_local_0' })
    await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedError)
    process.env.APP_ENV = 'development'
    expect((await verifier.verify(token)).id).toBe('ana')
  })

  it('rejeita token pré-definido sem prefixo pat_ ou curto', async () => {
    await expect(store.issue({ ...owner, token: 'curto' })).rejects.toThrow()
  })
})
```

Run: `npx vitest run tests/unit/personalTokens.test.ts`
Expected: FAIL (`InMemoryPersonalTokenStore` não exportado).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/auth/IAccessTokenVerifier.ts
import type { AuthUser } from './AuthUser'

/** Bearer token (JWT OAuth ou PAT) → AuthUser. Token inválido → UnauthorizedError. */
export interface IAccessTokenVerifier {
  verify(token: string): Promise<AuthUser>
}
```

```typescript
// src/shared/auth/personalTokens.ts
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { isDevEnvironment } from '@/shared/appEnv'
import { UnauthorizedError } from '@/shared/errors'
import { systemClock, type Clock } from '@/shared/kernel'
import type { AuthUser } from './AuthUser'
import type { IAccessTokenVerifier } from './IAccessTokenVerifier'

export const PAT_PREFIX = 'pat_'
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000
const MIN_TOKEN_LENGTH = 32

/** Espelha a tabela `personal_access_tokens` (in-memory no skeleton). */
export interface PersonalTokenRecord {
  id: string
  userId: string
  tenantId: string
  tokenHash: string
  scopes: string[]
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
  devOnly: boolean
}

export interface IssueTokenInput {
  userId: string
  tenantId: string
  scopes: string[]
  expiresAt?: Date
  /** Só para o token de Dev vindo do env; o padrão é gerar um aleatório. */
  token?: string
  devOnly?: boolean
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class InMemoryPersonalTokenStore {
  private byHash = new Map<string, PersonalTokenRecord>()

  constructor(private readonly clock: Clock = systemClock) {}

  async issue(input: IssueTokenInput): Promise<string> {
    const token = input.token ?? `${PAT_PREFIX}${randomBytes(32).toString('base64url')}`
    if (!token.startsWith(PAT_PREFIX) || token.length < MIN_TOKEN_LENGTH) {
      throw new Error(`Token pessoal precisa começar com ${PAT_PREFIX} e ter ${MIN_TOKEN_LENGTH}+ caracteres`)
    }
    const now = this.clock.now()
    const record: PersonalTokenRecord = {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      tokenHash: hashToken(token),
      scopes: [...input.scopes],
      createdAt: now,
      expiresAt: input.expiresAt ?? new Date(now.getTime() + DEFAULT_TTL_MS),
      revokedAt: null,
      lastUsedAt: null,
      devOnly: input.devOnly ?? false,
    }
    this.byHash.set(record.tokenHash, record)
    return token
  }

  async revoke(token: string): Promise<void> {
    const record = this.byHash.get(hashToken(token))
    if (record) record.revokedAt = this.clock.now()
  }

  async findByHash(tokenHash: string): Promise<PersonalTokenRecord | null> {
    const record = this.byHash.get(tokenHash)
    return record ? { ...record, scopes: [...record.scopes] } : null
  }

  async touch(id: string, at: Date): Promise<void> {
    for (const record of this.byHash.values()) {
      if (record.id === id) record.lastUsedAt = at
    }
  }

  clear(): void {
    this.byHash.clear()
  }
}

export class PersonalTokenVerifier implements IAccessTokenVerifier {
  constructor(
    private readonly store: InMemoryPersonalTokenStore,
    private readonly clock: Clock = systemClock
  ) {}

  async verify(token: string): Promise<AuthUser> {
    const record = await this.store.findByHash(hashToken(token))
    const now = this.clock.now()
    const isUsable =
      record !== null &&
      record.revokedAt === null &&
      record.expiresAt > now &&
      (!record.devOnly || isDevEnvironment())
    if (!record || !isUsable) throw new UnauthorizedError('Token inválido, expirado ou revogado')
    await this.store.touch(record.id, now)
    return { id: record.userId, tenantId: record.tenantId, scopes: record.scopes, via: 'pat' }
  }
}
```

Acrescente ao `src/shared/auth/index.ts`:

```typescript
export type { IAccessTokenVerifier } from './IAccessTokenVerifier'
export {
  InMemoryPersonalTokenStore,
  PersonalTokenVerifier,
  hashToken,
  PAT_PREFIX,
  type PersonalTokenRecord,
  type IssueTokenInput,
} from './personalTokens'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/personalTokens.test.ts && npm run type-check`
Expected: PASS (8 testes).

- [ ] **Step 4: Commit**

```bash
git add src/shared/auth tests/unit/personalTokens.test.ts
git commit -m "feat(auth): tokens pessoais com hash SHA-256, expiração e revogação"
```

---
### Task 11: `Auth0JwtVerifier` (jose + JWKS)

**Files:**
- Create: `src/shared/auth/Auth0JwtVerifier.ts` (exportar no `index.ts`)
- Test: `tests/unit/Auth0JwtVerifier.test.ts`

**Interfaces:**
- Consumes: `IAccessTokenVerifier` (Task 10), `UnauthorizedError`.
- Produces: `new Auth0JwtVerifier({ issuer: string; audience: string; jwks?: JWTVerifyGetKey; tenantClaim?: string })`. Sem `jwks`, usa `createRemoteJWKSet(<issuer>/.well-known/jwks.json)` com cache **por issuer** em nível de módulo (construir por requisição é barato). `verify(token)` → `{ id: sub, tenantId: claim tenantClaim (padrão 'tenant_id') ?? sub, scopes: scope.split(' '), via: 'oauth' }`. Erros do jose (`JOSEError`) e `sub` ausente → `UnauthorizedError`; qualquer outro erro sobe (técnico). Issuer normalizado com `/` final (formato do Auth0).

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/Auth0JwtVerifier.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose'
import { Auth0JwtVerifier } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'

const ISSUER = 'https://tenant.example.auth0.com/'
const AUDIENCE = 'https://uat.example.com/api/mcp'

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let privateKey: Key
let otherKey: Key
let jwks: JWTVerifyGetKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  otherKey = (await generateKeyPair('RS256')).privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }
  jwks = createLocalJWKSet({ keys: [jwk] })
})

function sign(claims: Record<string, unknown>, opts: { aud?: string | string[]; iss?: string; exp?: string; key?: Key } = {}) {
  return new SignJWT({ scope: 'resources:read', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('auth0|ana')
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey)
}

const verifier = () => new Auth0JwtVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks })

describe('Auth0JwtVerifier', () => {
  it('token válido → AuthUser via oauth com escopos', async () => {
    expect(await verifier().verify(await sign({}))).toEqual({
      id: 'auth0|ana',
      tenantId: 'auth0|ana',
      scopes: ['resources:read'],
      via: 'oauth',
    })
  })

  it('aceita aud em array que contém a URL do MCP', async () => {
    const token = await sign({}, { aud: ['https://tenant.example.auth0.com/userinfo', AUDIENCE] })
    expect((await verifier().verify(token)).id).toBe('auth0|ana')
  })

  it('usa a claim de tenant quando presente', async () => {
    expect((await verifier().verify(await sign({ tenant_id: 'acme' }))).tenantId).toBe('acme')
  })

  it('aud sem a URL do MCP → UnauthorizedError', async () => {
    await expect(verifier().verify(await sign({}, { aud: 'https://outra-api' }))).rejects.toThrow(UnauthorizedError)
  })

  it('iss errado → UnauthorizedError', async () => {
    await expect(verifier().verify(await sign({}, { iss: 'https://evil.auth0.com/' }))).rejects.toThrow(UnauthorizedError)
  })

  it('expirado → UnauthorizedError', async () => {
    await expect(verifier().verify(await sign({}, { exp: '-1m' }))).rejects.toThrow(UnauthorizedError)
  })

  it('assinado por outra chave → UnauthorizedError', async () => {
    await expect(verifier().verify(await sign({}, { key: otherKey }))).rejects.toThrow(UnauthorizedError)
  })

  it('lixo no lugar do token → UnauthorizedError', async () => {
    await expect(verifier().verify('nao.e.jwt')).rejects.toThrow(UnauthorizedError)
  })

  it('issuer sem barra final é normalizado', async () => {
    const v = new Auth0JwtVerifier({ issuer: 'https://tenant.example.auth0.com', audience: AUDIENCE, jwks })
    expect((await v.verify(await sign({}))).via).toBe('oauth')
  })
})
```

Run: `npx vitest run tests/unit/Auth0JwtVerifier.test.ts`
Expected: FAIL (`Auth0JwtVerifier` não exportado).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/auth/Auth0JwtVerifier.ts
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { UnauthorizedError } from '@/shared/errors'
import type { AuthUser } from './AuthUser'
import type { IAccessTokenVerifier } from './IAccessTokenVerifier'

export interface Auth0JwtVerifierOptions {
  issuer: string
  /** URL do MCP do ambiente (= audience da API no Auth0). */
  audience: string
  /** Injete um JWKS local em teste; em runtime usa o JWKS remoto do issuer. */
  jwks?: JWTVerifyGetKey
  tenantClaim?: string
}

const remoteJwksByIssuer = new Map<string, JWTVerifyGetKey>()

function remoteJwks(issuer: string): JWTVerifyGetKey {
  let jwks = remoteJwksByIssuer.get(issuer)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', issuer))
    remoteJwksByIssuer.set(issuer, jwks)
  }
  return jwks
}

export class Auth0JwtVerifier implements IAccessTokenVerifier {
  private readonly issuer: string
  private readonly jwks: JWTVerifyGetKey

  constructor(private readonly options: Auth0JwtVerifierOptions) {
    this.issuer = options.issuer.endsWith('/') ? options.issuer : `${options.issuer}/`
    this.jwks = options.jwks ?? remoteJwks(this.issuer)
  }

  async verify(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.options.audience,
        algorithms: ['RS256'],
      })
      if (!payload.sub) throw new UnauthorizedError('Token sem sub')
      const tenant = payload[this.options.tenantClaim ?? 'tenant_id']
      const scope = typeof payload.scope === 'string' ? payload.scope : ''
      return {
        id: payload.sub,
        tenantId: typeof tenant === 'string' && tenant ? tenant : payload.sub,
        scopes: scope.split(' ').filter(Boolean),
        via: 'oauth',
      }
    } catch (error) {
      if (error instanceof errors.JOSEError) throw new UnauthorizedError('Token inválido ou expirado')
      throw error
    }
  }
}
```

Acrescente ao `src/shared/auth/index.ts`:

```typescript
export { Auth0JwtVerifier, type Auth0JwtVerifierOptions } from './Auth0JwtVerifier'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/Auth0JwtVerifier.test.ts && npm run type-check`
Expected: PASS (9 testes).

- [ ] **Step 4: Commit**

```bash
git add src/shared/auth tests/unit/Auth0JwtVerifier.test.ts
git commit -m "feat(auth): Auth0JwtVerifier com JWKS, iss, aud (array), exp e escopos"
```

---

### Task 12: Bearer token e verificador composto (`pat_` → PAT; senão → JWT)

**Files:**
- Create: `src/shared/auth/bearer.ts` (exportar no `index.ts`)
- Test: `tests/unit/bearer.test.ts`

**Interfaces:**
- Consumes: `IAccessTokenVerifier`, `PAT_PREFIX` (Task 10).
- Produces: `readBearerToken(req): string | null` (esquema `Bearer` sem diferenciar maiúsculas; vazio → `null`); `new CompositeTokenVerifier(pat: IAccessTokenVerifier, jwt: IAccessTokenVerifier | null)` — sem verificador JWT configurado, token não-PAT → `UnauthorizedError`.

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/bearer.test.ts
import { describe, it, expect, vi } from 'vitest'
import { CompositeTokenVerifier, readBearerToken, type IAccessTokenVerifier } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'
import { makeActor } from '../helpers/makeActor'

const withAuth = (value?: string) =>
  new Request('http://localhost/api/mcp', { headers: value ? { authorization: value } : {} })

const fake = (via: 'pat' | 'oauth'): IAccessTokenVerifier => ({
  verify: vi.fn(async () => makeActor({ via })),
})

describe('readBearerToken', () => {
  it('lê o token do header Authorization', () => {
    expect(readBearerToken(withAuth('Bearer abc'))).toBe('abc')
    expect(readBearerToken(withAuth('bearer abc'))).toBe('abc')
  })
  it('ausente, vazio ou outro esquema → null', () => {
    expect(readBearerToken(withAuth())).toBeNull()
    expect(readBearerToken(withAuth('Bearer   '))).toBeNull()
    expect(readBearerToken(withAuth('Basic abc'))).toBeNull()
  })
})

describe('CompositeTokenVerifier', () => {
  it('pat_ → PersonalTokenVerifier', async () => {
    const pat = fake('pat')
    const jwt = fake('oauth')
    expect((await new CompositeTokenVerifier(pat, jwt).verify('pat_x')).via).toBe('pat')
    expect(jwt.verify).not.toHaveBeenCalled()
  })
  it('outro formato → verificador JWT', async () => {
    expect((await new CompositeTokenVerifier(fake('pat'), fake('oauth')).verify('eyJ...')).via).toBe('oauth')
  })
  it('sem verificador JWT configurado → UnauthorizedError', async () => {
    await expect(new CompositeTokenVerifier(fake('pat'), null).verify('eyJ...')).rejects.toThrow(UnauthorizedError)
  })
})
```

Run: `npx vitest run tests/unit/bearer.test.ts`
Expected: FAIL (`readBearerToken` não exportado).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/auth/bearer.ts
import { UnauthorizedError } from '@/shared/errors'
import type { AuthUser } from './AuthUser'
import type { IAccessTokenVerifier } from './IAccessTokenVerifier'
import { PAT_PREFIX } from './personalTokens'

export function readBearerToken(req: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')
  const token = match?.[1]?.trim()
  return token ? token : null
}

/** Escolhe o verificador pelo formato do token (ADR-012). */
export class CompositeTokenVerifier implements IAccessTokenVerifier {
  constructor(
    private readonly pat: IAccessTokenVerifier,
    private readonly jwt: IAccessTokenVerifier | null
  ) {}

  async verify(token: string): Promise<AuthUser> {
    if (token.startsWith(PAT_PREFIX)) return this.pat.verify(token)
    if (!this.jwt) throw new UnauthorizedError('OAuth não configurado neste ambiente')
    return this.jwt.verify(token)
  }
}
```

Acrescente ao `src/shared/auth/index.ts`:

```typescript
export { readBearerToken, CompositeTokenVerifier } from './bearer'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/bearer.test.ts && npm run type-check`
Expected: PASS (5 testes).

- [ ] **Step 4: Commit**

```bash
git add src/shared/auth tests/unit/bearer.test.ts
git commit -m "feat(auth): leitura de bearer token e verificador composto PAT/JWT"
```

---

### Task 13: `defineTool` e filtro do registry (flag × escopo)

**Files:**
- Create: `src/shared/mcp/defineTool.ts`, `src/shared/mcp/registry.ts`, `src/shared/mcp/index.ts`
- Test: `tests/unit/mcpRegistry.test.ts`

**Interfaces:**
- Consumes: `FlagName`, `isEnabled` (Task 3); `AuthUser`, `hasScope` (Task 2).
- Produces: `ToolDefinition<I extends ZodTypeAny, O extends Record<string, unknown>, F extends FlagName>` com `name`, `description`, `input: I`, `output?: ZodTypeAny`, `scope: string` (**obrigatório**), `flag: F`, `annotations` (flag terminando em `.write` exige `{ readOnlyHint: false; destructiveHint: boolean; idempotentHint: boolean }`; senão `{ readOnlyHint: true }`), `handler(actor, input: z.output<I>): Promise<O>`; `defineTool(def)`; `type AnyTool`; `visibleTools(tools, actor, env = process.env): AnyTool[]`; `assertUniqueToolNames(tools)` (lança `Error` em duplicata). Export via `@/shared/mcp`.

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/mcpRegistry.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineTool, visibleTools, assertUniqueToolNames } from '@/shared/mcp'
import { makeActor } from '../helpers/makeActor'

const readTool = defineTool({
  name: 'list_things',
  description: 'Lista coisas.',
  input: z.object({}),
  scope: 'things:read',
  annotations: { readOnlyHint: true },
  flag: 'mcp.resources.read',
  handler: async () => ({ items: [] }),
})

const writeTool = defineTool({
  name: 'create_thing',
  description: 'Cria coisa.',
  input: z.object({ title: z.string() }),
  scope: 'things:write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  flag: 'mcp.resources.write',
  handler: async (_actor, input) => ({ title: input.title }),
})

const tools = [readTool, writeTool]
const names = (ts: { name: string }[]) => ts.map((t) => t.name)
const both = makeActor({ scopes: ['things:read', 'things:write'] })

describe('visibleTools', () => {
  it('escrita fica oculta com a flag desligada (padrão), mesmo com escopo', () => {
    expect(names(visibleTools(tools, both, {}))).toEqual(['list_things'])
  })
  it('flag ligada mas sem escopo → oculta', () => {
    const readOnly = makeActor({ scopes: ['things:read'] })
    expect(names(visibleTools(tools, readOnly, { MCP_RESOURCES_WRITE: 'on' }))).toEqual(['list_things'])
  })
  it('flag ligada E escopo → visível', () => {
    expect(names(visibleTools(tools, both, { MCP_RESOURCES_WRITE: 'on' }))).toEqual(['list_things', 'create_thing'])
  })
  it('flag de leitura desligada → leitura oculta', () => {
    expect(names(visibleTools(tools, both, { MCP_RESOURCES_READ: 'off' }))).toEqual([])
  })
})

describe('assertUniqueToolNames', () => {
  it('lança com nomes duplicados', () => {
    expect(() => assertUniqueToolNames([readTool, readTool])).toThrow('list_things')
  })
})

describe('defineTool (contrato de tipos — checado pelo type-check)', () => {
  it('tool sem scope não compila; escrita com readOnlyHint: true não compila', () => {
    // @ts-expect-error scope é obrigatório
    defineTool({ name: 'x', description: 'x', input: z.object({}), annotations: { readOnlyHint: true }, flag: 'mcp.resources.read', handler: async () => ({}) })
    defineTool({
      name: 'y',
      description: 'y',
      input: z.object({}),
      scope: 's:write',
      // @ts-expect-error flag de escrita exige readOnlyHint: false + destructive/idempotent
      annotations: { readOnlyHint: true },
      flag: 'mcp.resources.write',
      handler: async () => ({}),
    })
    expect(true).toBe(true)
  })
})
```

Run: `npx vitest run tests/unit/mcpRegistry.test.ts`
Expected: FAIL (`@/shared/mcp` não existe).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/mcp/defineTool.ts
import type { z, ZodTypeAny } from 'zod'
import type { AuthUser } from '@/shared/auth'
import type { FlagName } from '@/shared/featureFlags'

export interface ReadToolAnnotations {
  readOnlyHint: true
}

export interface WriteToolAnnotations {
  readOnlyHint: false
  destructiveHint: boolean
  idempotentHint: boolean
}

/** Flag de escrita (`*.write`) exige anotações de escrita honestas (ADR-012). */
export type ToolAnnotationsFor<F extends FlagName> = F extends `${string}.write`
  ? WriteToolAnnotations
  : ReadToolAnnotations

export interface ToolDefinition<
  I extends ZodTypeAny,
  O extends Record<string, unknown>,
  F extends FlagName,
> {
  /** verbo_substantivo, snake_case, em inglês, na linguagem do negócio. */
  name: string
  /** Diz QUANDO usar, não só o que faz. */
  description: string
  input: I
  output?: ZodTypeAny
  scope: string
  flag: F
  annotations: ToolAnnotationsFor<F>
  handler: (actor: AuthUser, input: z.output<I>) => Promise<O>
}

export type AnyTool = ToolDefinition<ZodTypeAny, Record<string, unknown>, FlagName>

export function defineTool<I extends ZodTypeAny, O extends Record<string, unknown>, F extends FlagName>(
  def: ToolDefinition<I, O, F>
): ToolDefinition<I, O, F> {
  return def
}
```

```typescript
// src/shared/mcp/registry.ts
import { hasScope, type AuthUser } from '@/shared/auth'
import { isEnabled } from '@/shared/featureFlags'
import type { AnyTool } from './defineTool'

type Env = Record<string, string | undefined>

/** Só as tools com flag ligada E escopo presente no actor. */
export function visibleTools(tools: readonly AnyTool[], actor: AuthUser, env: Env = process.env): AnyTool[] {
  return tools.filter((tool) => isEnabled(tool.flag, env) && hasScope(actor, tool.scope))
}

export function assertUniqueToolNames(tools: readonly AnyTool[]): void {
  const seen = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`Tool MCP duplicada: ${tool.name}`)
    seen.add(tool.name)
  }
}
```

```typescript
// src/shared/mcp/index.ts
export {
  defineTool,
  type AnyTool,
  type ToolDefinition,
  type ReadToolAnnotations,
  type WriteToolAnnotations,
} from './defineTool'
export { visibleTools, assertUniqueToolNames } from './registry'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/mcpRegistry.test.ts && npm run type-check`
Expected: PASS (6 testes); o type-check confirma os dois `@ts-expect-error` (se algum deixar de ser erro, o tsc falha com "Unused '@ts-expect-error' directive").

- [ ] **Step 4: Commit**

```bash
git add src/shared/mcp tests/unit/mcpRegistry.test.ts
git commit -m "feat(mcp): defineTool com escopo obrigatório e filtro flag × escopo"
```

---

### Task 14: `toToolError` (funcional acionável × técnico genérico)

**Files:**
- Create: `src/shared/mcp/toToolError.ts` (exportar no `index.ts`)
- Test: `tests/unit/toToolError.test.ts`

**Interfaces:**
- Consumes: `AppError`, `logError`.
- Produces: `toolError(message, code): CallToolResult` → `{ isError: true, content: [{ type: 'text', text: message }], _meta: { code } }`; `toToolError(error, context): CallToolResult` — `ZodError` → 1ª mensagem + `VALIDATION_ERROR` (sem log); `AppError` → mensagem + `code` (sem log); outro → `logError(context, error)` + `'Falha temporária, tente novamente.'` + `INTERNAL_ERROR`.

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/toToolError.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { toToolError } from '@/shared/mcp'
import { ForbiddenError } from '@/shared/errors'

afterEach(() => vi.restoreAllMocks())

describe('toToolError', () => {
  it('ZodError → isError com a mensagem do schema (funcional — não loga)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const parsed = z.object({ title: z.string().min(3, 'Título curto') }).safeParse({ title: 'a' })
    const result = toToolError(parsed.error, 'mcp:create_resource')
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'Título curto' }], _meta: { code: 'VALIDATION_ERROR' } })
    expect(spy).not.toHaveBeenCalled()
  })

  it('AppError → isError com mensagem e code (funcional — não loga)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = toToolError(new ForbiddenError('Permissão ausente: resources:write'), 'mcp:x')
    expect(result._meta).toEqual({ code: 'FORBIDDEN' })
    expect(result.content).toEqual([{ type: 'text', text: 'Permissão ausente: resources:write' }])
    expect(spy).not.toHaveBeenCalled()
  })

  it('erro desconhecido → mensagem genérica, sem detalhe interno, e loga (técnico)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = toToolError(new Error('connection refused 10.0.0.5'), 'mcp:list_resources')
    expect(result.content).toEqual([{ type: 'text', text: 'Falha temporária, tente novamente.' }])
    expect(result._meta).toEqual({ code: 'INTERNAL_ERROR' })
    expect(spy).toHaveBeenCalledWith('[mcp:list_resources]', expect.objectContaining({ message: 'connection refused 10.0.0.5' }))
  })
})
```

Run: `npx vitest run tests/unit/toToolError.test.ts`
Expected: FAIL (`toToolError` não exportado).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/mcp/toToolError.ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ZodError } from 'zod'
import { AppError } from '@/shared/errors'
import { logError } from '@/shared/logError'

export function toolError(message: string, code: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }], _meta: { code } }
}

/** Fronteira de erro da borda MCP (ADR-009): funcional acionável; técnico genérico + log. */
export function toToolError(error: unknown, context: string): CallToolResult {
  if (error instanceof ZodError) {
    return toolError(error.issues[0]?.message ?? 'Dados inválidos', 'VALIDATION_ERROR')
  }
  if (error instanceof AppError) return toolError(error.message, error.code)
  logError(context, error)
  return toolError('Falha temporária, tente novamente.', 'INTERNAL_ERROR')
}
```

Acrescente ao `src/shared/mcp/index.ts`:

```typescript
export { toToolError, toolError } from './toToolError'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/toToolError.test.ts && npm run type-check`
Expected: PASS (3 testes).

- [ ] **Step 4: Commit**

```bash
git add src/shared/mcp tests/unit/toToolError.test.ts
git commit -m "feat(mcp): toToolError separa erro funcional de técnico"
```

---

### Task 15: Rate limit por ator e log de auditoria

**Files:**
- Create: `src/shared/mcp/rateLimit.ts`, `src/shared/mcp/audit.ts` (exportar no `index.ts`)
- Test: `tests/unit/rateLimitAudit.test.ts`

**Interfaces:**
- Consumes: `RateLimitedError` (Task 1), `Clock`, `AuthVia`.
- Produces: `interface IRateLimiter { consume(key: string): Promise<void> }` (estoura → `RateLimitedError`); `InMemoryRateLimiter({ limit, windowMs }, clock = systemClock)` com janela fixa e `clear()`. `interface AuditEntry { at: string; actorId: string; tenantId: string; via: AuthVia; tool: string; outcome: 'ok' | 'error'; code?: string }` (**sem payload**); `interface IAuditLog { record(entry): Promise<void> }`; `InMemoryAuditLog` com `entries: readonly AuditEntry[]` e `clear()`. Em projeto real: tabela Postgres (ADR-010) e tabela de auditoria.

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/rateLimitAudit.test.ts
import { describe, it, expect } from 'vitest'
import { InMemoryRateLimiter, InMemoryAuditLog } from '@/shared/mcp'
import { RateLimitedError } from '@/shared/errors'
import type { Clock } from '@/shared/kernel'

let now = 0
const clock: Clock = { now: () => new Date(now) }

describe('InMemoryRateLimiter', () => {
  it('permite até o limite e recusa o excedente na mesma janela', async () => {
    now = 0
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 1000 }, clock)
    await limiter.consume('t1:ana')
    await limiter.consume('t1:ana')
    await expect(limiter.consume('t1:ana')).rejects.toThrow(RateLimitedError)
  })

  it('isola por chave (ator)', async () => {
    now = 0
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, clock)
    await limiter.consume('t1:ana')
    await expect(limiter.consume('t1:bia')).resolves.toBeUndefined()
  })

  it('libera na janela seguinte', async () => {
    now = 0
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, clock)
    await limiter.consume('t1:ana')
    now = 1000
    await expect(limiter.consume('t1:ana')).resolves.toBeUndefined()
  })
})

describe('InMemoryAuditLog', () => {
  it('registra e limpa entradas', async () => {
    const audit = new InMemoryAuditLog()
    await audit.record({ at: '2026-01-01T00:00:00.000Z', actorId: 'ana', tenantId: 't1', via: 'pat', tool: 'create_resource', outcome: 'ok' })
    expect(audit.entries).toHaveLength(1)
    audit.clear()
    expect(audit.entries).toHaveLength(0)
  })
})
```

Run: `npx vitest run tests/unit/rateLimitAudit.test.ts`
Expected: FAIL (`InMemoryRateLimiter` não exportado).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/mcp/rateLimit.ts
import { RateLimitedError } from '@/shared/errors'
import { systemClock, type Clock } from '@/shared/kernel'

export interface IRateLimiter {
  /** Conta uma chamada para a chave; estourou o limite → RateLimitedError. */
  consume(key: string): Promise<void>
}

/** Janela fixa em memória (skeleton). Em projeto real: tabela Postgres (ADR-010). */
export class InMemoryRateLimiter implements IRateLimiter {
  private windows = new Map<string, { start: number; count: number }>()

  constructor(
    private readonly options: { limit: number; windowMs: number },
    private readonly clock: Clock = systemClock
  ) {}

  async consume(key: string): Promise<void> {
    const now = this.clock.now().getTime()
    const window = this.windows.get(key)
    if (!window || now - window.start >= this.options.windowMs) {
      this.windows.set(key, { start: now, count: 1 })
      return
    }
    if (window.count >= this.options.limit) throw new RateLimitedError()
    window.count += 1
  }

  clear(): void {
    this.windows.clear()
  }
}
```

```typescript
// src/shared/mcp/audit.ts
import type { AuthVia } from '@/shared/auth'

/** Quem chamou qual tool de escrita, quando e com que resultado — nunca o payload. */
export interface AuditEntry {
  at: string
  actorId: string
  tenantId: string
  via: AuthVia
  tool: string
  outcome: 'ok' | 'error'
  code?: string
}

export interface IAuditLog {
  record(entry: AuditEntry): Promise<void>
}

/** Em memória no skeleton; em projeto real, uma tabela de auditoria append-only. */
export class InMemoryAuditLog implements IAuditLog {
  private readonly items: AuditEntry[] = []

  get entries(): readonly AuditEntry[] {
    return this.items
  }

  async record(entry: AuditEntry): Promise<void> {
    this.items.push(entry)
  }

  clear(): void {
    this.items.length = 0
  }
}
```

Acrescente ao `src/shared/mcp/index.ts`:

```typescript
export { InMemoryRateLimiter, type IRateLimiter } from './rateLimit'
export { InMemoryAuditLog, type IAuditLog, type AuditEntry } from './audit'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/rateLimitAudit.test.ts && npm run type-check`
Expected: PASS (4 testes).

- [ ] **Step 4: Commit**

```bash
git add src/shared/mcp tests/unit/rateLimitAudit.test.ts
git commit -m "feat(mcp): rate limit por ator e log de auditoria em memória"
```

---
### Task 16: Config do MCP e metadado `/.well-known/oauth-protected-resource`

**Files:**
- Create: `src/shared/mcp/config.ts`, `src/shared/mcp/protectedResource.ts` (exportar no `index.ts`)
- Test: `tests/unit/mcpConfig.test.ts`

**Interfaces:**
- Consumes: `isDevEnvironment` (Task 8), `logError`, `AnyTool` (Task 13).
- Produces: `interface McpConfig { resourceUrl: URL; issuerBaseUrl: URL | null; resourceMetadataUrl: string }`; `loadMcpConfig(env = process.env): McpConfig` — `MCP_RESOURCE_URL` obrigatório; fora do Dev, `MCP_RESOURCE_URL` e `AUTH0_ISSUER_BASE_URL` exigem `https:`; inválido → `Error` (técnico). `resourceMetadataUrl = <origin de MCP_RESOURCE_URL>/.well-known/oauth-protected-resource`. `makeProtectedResourceMetadataHandler(tools)` → `{ GET(): Response }` com `{ resource, authorization_servers, scopes_supported, bearer_methods_supported: ['header'] }`; config inválida → `logError` + 500 genérico.

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/mcpConfig.test.ts
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
```

Run: `npx vitest run tests/unit/mcpConfig.test.ts`
Expected: FAIL (`loadMcpConfig` não exportado).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/mcp/config.ts
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
```

```typescript
// src/shared/mcp/protectedResource.ts
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
```

Acrescente ao `src/shared/mcp/index.ts`:

```typescript
export { loadMcpConfig, type McpConfig } from './config'
export { makeProtectedResourceMetadataHandler } from './protectedResource'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/mcpConfig.test.ts && npm run type-check`
Expected: PASS (7 testes).

- [ ] **Step 4: Commit**

```bash
git add src/shared tests/unit/mcpConfig.test.ts
git commit -m "feat(mcp): config por ambiente e metadado oauth-protected-resource"
```

---
### Task 17: `callTool` — semântica de `tools/call` (flag → escopo → rate limit → Zod → handler → auditoria)

**Files:**
- Create: `src/shared/mcp/callTool.ts` (exportar no `index.ts`)
- Test: `tests/unit/callTool.test.ts`

**Interfaces:**
- Consumes: `AnyTool` (Task 13), `toToolError`/`toolError` (Task 14), `IRateLimiter`/`IAuditLog` (Task 15), `requireScope` (Task 2), `isEnabled` (Task 3), `systemClock`.
- Produces: `interface CallToolDeps { rateLimiter: IRateLimiter; audit: IAuditLog; clock?: Clock; env?: Env }`; `callTool(tools, actor, name, args: unknown, deps): Promise<CallToolResult>`. Ordem: tool inexistente **ou** flag desligada → `NOT_FOUND` (sem executar); `requireScope`; `rateLimiter.consume('<tenantId>:<id>')`; `tool.input.parse(args ?? {})` (campos extras como `ownerId` são descartados pelo `z.object`); handler; sucesso → `{ content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }`. Erros via `toToolError(error, 'mcp:<name>')`. Tool de escrita (`readOnlyHint: false`) é auditada **sempre que existe e está ligada** — `ok` ou `error` com `code` — **sem payload**. Leitura não é auditada.

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/callTool.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { callTool, defineTool, InMemoryAuditLog, InMemoryRateLimiter } from '@/shared/mcp'
import { makeActor } from '../helpers/makeActor'
import { fixedClock } from '../helpers/fixedClock'

const readHandler = vi.fn(async () => ({ items: [] as string[] }))
const writeHandler = vi.fn(async (_actor: unknown, input: Record<string, unknown>) => ({ received: input }))

const tools = [
  defineTool({
    name: 'list_things',
    description: 'x',
    input: z.object({}),
    scope: 'things:read',
    annotations: { readOnlyHint: true },
    flag: 'mcp.resources.read',
    handler: readHandler,
  }),
  defineTool({
    name: 'create_thing',
    description: 'x',
    input: z.object({ title: z.string().min(3, 'Título curto') }),
    scope: 'things:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    flag: 'mcp.resources.write',
    handler: writeHandler,
  }),
]

const writer = makeActor({ id: 'ana', tenantId: 't1', via: 'pat', scopes: ['things:read', 'things:write'] })
const WRITE_ON = { MCP_RESOURCES_WRITE: 'on' }

let audit: InMemoryAuditLog
let rateLimiter: InMemoryRateLimiter
const deps = (env: Record<string, string> = WRITE_ON) => ({ audit, rateLimiter, clock: fixedClock, env })

beforeEach(() => {
  audit = new InMemoryAuditLog()
  rateLimiter = new InMemoryRateLimiter({ limit: 100, windowMs: 60_000 }, fixedClock)
})
afterEach(() => vi.clearAllMocks())

describe('callTool', () => {
  it('sucesso → structuredContent + texto JSON', async () => {
    const result = await callTool(tools, writer, 'list_things', {}, deps())
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({ items: [] })
    expect(result.content).toEqual([{ type: 'text', text: '{"items":[]}' }])
  })

  it('tool inexistente → NOT_FOUND', async () => {
    const result = await callTool(tools, writer, 'drop_tables', {}, deps())
    expect(result).toMatchObject({ isError: true, _meta: { code: 'NOT_FOUND' } })
  })

  it('flag de escrita desligada → NOT_FOUND e não executa nem audita', async () => {
    const result = await callTool(tools, writer, 'create_thing', { title: 'Novo' }, deps({}))
    expect(result._meta).toEqual({ code: 'NOT_FOUND' })
    expect(writeHandler).not.toHaveBeenCalled()
    expect(audit.entries).toHaveLength(0)
  })

  it('sem escopo → FORBIDDEN, não executa e audita o erro', async () => {
    const reader = makeActor({ id: 'ana', tenantId: 't1', scopes: ['things:read'] })
    const result = await callTool(tools, reader, 'create_thing', { title: 'Novo' }, deps())
    expect(result._meta).toEqual({ code: 'FORBIDDEN' })
    expect(writeHandler).not.toHaveBeenCalled()
    expect(audit.entries).toEqual([
      expect.objectContaining({ actorId: 'ana', tool: 'create_thing', outcome: 'error', code: 'FORBIDDEN' }),
    ])
  })

  it('args inválidos → VALIDATION_ERROR com a mensagem do schema', async () => {
    const result = await callTool(tools, writer, 'create_thing', { title: 'a' }, deps())
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Título curto' }] })
    expect(writeHandler).not.toHaveBeenCalled()
  })

  it('descarta ownerId/tenantId vindos da LLM', async () => {
    await callTool(tools, writer, 'create_thing', { title: 'Novo', ownerId: 'bia', tenantId: 't2' }, deps())
    expect(writeHandler).toHaveBeenCalledWith(writer, { title: 'Novo' })
  })

  it('escrita ok → auditada sem payload', async () => {
    await callTool(tools, writer, 'create_thing', { title: 'Novo' }, deps())
    expect(audit.entries).toEqual([
      { at: '2026-01-01T00:00:00.000Z', actorId: 'ana', tenantId: 't1', via: 'pat', tool: 'create_thing', outcome: 'ok' },
    ])
  })

  it('leitura não é auditada', async () => {
    await callTool(tools, writer, 'list_things', {}, deps())
    expect(audit.entries).toHaveLength(0)
  })

  it('rate limit estourado → RATE_LIMITED e não executa', async () => {
    rateLimiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 }, fixedClock)
    await callTool(tools, writer, 'list_things', {}, deps())
    const result = await callTool(tools, writer, 'list_things', {}, deps())
    expect(result._meta).toEqual({ code: 'RATE_LIMITED' })
    expect(readHandler).toHaveBeenCalledTimes(1)
  })

  it('falha técnica no handler → mensagem genérica (e loga)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    readHandler.mockRejectedValueOnce(new Error('db down'))
    const result = await callTool(tools, writer, 'list_things', {}, deps())
    expect(result).toMatchObject({ isError: true, _meta: { code: 'INTERNAL_ERROR' } })
    expect(JSON.stringify(result)).not.toContain('db down')
    spy.mockRestore()
  })
})
```

Run: `npx vitest run tests/unit/callTool.test.ts`
Expected: FAIL (`callTool` não exportado).

- [ ] **Step 2: Implementar**

```typescript
// src/shared/mcp/callTool.ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { requireScope, type AuthUser } from '@/shared/auth'
import { isEnabled } from '@/shared/featureFlags'
import { systemClock, type Clock } from '@/shared/kernel'
import type { IAuditLog } from './audit'
import type { AnyTool } from './defineTool'
import type { IRateLimiter } from './rateLimit'
import { toToolError, toolError } from './toToolError'

type Env = Record<string, string | undefined>

export interface CallToolDeps {
  rateLimiter: IRateLimiter
  audit: IAuditLog
  clock?: Clock
  env?: Env
}

export async function callTool(
  tools: readonly AnyTool[],
  actor: AuthUser,
  name: string,
  args: unknown,
  deps: CallToolDeps
): Promise<CallToolResult> {
  const tool = tools.find((t) => t.name === name)
  if (!tool || !isEnabled(tool.flag, deps.env ?? process.env)) {
    return toolError(`Tool não encontrada: ${name}`, 'NOT_FOUND')
  }

  const result = await execute(tool, actor, args, deps)

  if (!tool.annotations.readOnlyHint) {
    const code = result.isError ? String(result._meta?.code ?? 'INTERNAL_ERROR') : undefined
    await deps.audit.record({
      at: (deps.clock ?? systemClock).now().toISOString(),
      actorId: actor.id,
      tenantId: actor.tenantId,
      via: actor.via,
      tool: tool.name,
      outcome: result.isError ? 'error' : 'ok',
      ...(code ? { code } : {}),
    })
  }
  return result
}

async function execute(tool: AnyTool, actor: AuthUser, args: unknown, deps: CallToolDeps): Promise<CallToolResult> {
  try {
    requireScope(actor, tool.scope)
    await deps.rateLimiter.consume(`${actor.tenantId}:${actor.id}`)
    const input = tool.input.parse(args ?? {})
    const output = await tool.handler(actor, input)
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
  } catch (error) {
    return toToolError(error, `mcp:${tool.name}`)
  }
}
```

Acrescente ao `src/shared/mcp/index.ts`:

```typescript
export { callTool, type CallToolDeps } from './callTool'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/callTool.test.ts && npm run type-check`
Expected: PASS (10 testes).

- [ ] **Step 4: Commit**

```bash
git add src/shared/mcp tests/unit/callTool.test.ts
git commit -m "feat(mcp): callTool com flag, escopo, rate limit, Zod e auditoria"
```

---
### Task 18: Servidor MCP (`createMcpHandler`): auth → 401, `tools/list`, `tools/call`

**Files:**
- Create: `src/shared/mcp/server.ts` (exportar no `index.ts`), `tests/helpers/mcpRequest.ts`
- Test: `tests/unit/mcpServer.test.ts`

**Interfaces:**
- Consumes: `loadMcpConfig`/`McpConfig` (Task 16), `readBearerToken`/`IAccessTokenVerifier` (Tasks 10 e 12), `visibleTools`/`assertUniqueToolNames` (Task 13), `callTool` (Task 17), `UnauthorizedError`, `logError`.
- Produces: `interface McpHandlerDeps { tools: readonly AnyTool[]; verifierFor: (config: McpConfig) => IAccessTokenVerifier; rateLimiter; audit; env?: Env; info?: { name: string; version: string } }`; `createMcpHandler(deps): (req: Request) => Promise<Response>`. Config inválida → 500 JSON-RPC genérico (loga); sem token → 401 `WWW-Authenticate: Bearer resource_metadata="<url>"`; token recusado (`UnauthorizedError`) → 401 com `, error="invalid_token"`; outra falha do verificador → 500 (loga). Autenticado: `Server` do SDK + `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` **por requisição** (stateless). `tools/list` → `visibleTools` com `inputSchema`/`outputSchema` via `zodToJsonSchema(schema, { $refStrategy: 'none' })` sem `$schema`, e `annotations`. Helper de teste `rpc(method, params, token?)`.

- [ ] **Step 1: Helper de teste**

```typescript
// tests/helpers/mcpRequest.ts
export function rpc(method: string, params: unknown = {}, token?: string): Request {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}
```

- [ ] **Step 2: Teste que falha**

```typescript
// tests/unit/mcpServer.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { createMcpHandler, defineTool, InMemoryAuditLog, InMemoryRateLimiter } from '@/shared/mcp'
import { UnauthorizedError } from '@/shared/errors'
import type { IAccessTokenVerifier } from '@/shared/auth'
import { makeActor } from '../helpers/makeActor'
import { rpc } from '../helpers/mcpRequest'

afterEach(() => vi.restoreAllMocks())

const ENV = { MCP_RESOURCE_URL: 'http://localhost/api/mcp', APP_ENV: 'development' }

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
```

Run: `npx vitest run tests/unit/mcpServer.test.ts`
Expected: FAIL (`createMcpHandler` não exportado).

- [ ] **Step 3: Implementar**

```typescript
// src/shared/mcp/server.ts
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
import { assertUniqueToolNames, visibleTools } from './registry'

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
  assertUniqueToolNames(deps.tools)
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
```

Acrescente ao `src/shared/mcp/index.ts`:

```typescript
export { createMcpHandler, type McpHandlerDeps } from './server'
```

- [ ] **Step 4: Rodar**

Run: `npx vitest run tests/unit/mcpServer.test.ts && npm run type-check`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/shared/mcp tests/helpers/mcpRequest.ts tests/unit/mcpServer.test.ts
git commit -m "feat(mcp): servidor stateless com 401 + resource_metadata e tools/list filtrado"
```

---
### Task 19: Tools do módulo `resources` (`list_resources`, `create_resource`)

**Files:**
- Create: `src/modules/resources/interfaces/mcp/tools.ts` (exportar `makeResourceTools` no `index.ts`)
- Test: `tests/unit/resourceTools.test.ts`

**Interfaces:**
- Consumes: `defineTool` (Task 13), `ResourceService` (Task 7), schemas/DTO (Task 6).
- Produces: `makeResourceTools(service): AnyTool[]` com `list_resources` (input `listResourcesSchema`, output `resourcePageSchema`, `resources:read`, `{ readOnlyHint: true }`, `mcp.resources.read`; handler devolve `toResourcePage(await service.list(actor, input), input.limit)`) e `create_resource` (input `createResourceSchema`, output `resourceDTOSchema`, `resources:write`, `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false }`, `mcp.resources.write`).

- [ ] **Step 1: Teste que falha**

```typescript
// tests/unit/resourceTools.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { ResourceService, makeResourceTools } from '@/modules/resources'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'
import { makeActor } from '../helpers/makeActor'
import { fixedClock } from '../helpers/fixedClock'

let tools: ReturnType<typeof makeResourceTools>
const byName = (name: string) => {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool ${name} ausente`)
  return tool
}

beforeEach(() => {
  tools = makeResourceTools(new ResourceService(new InMemoryResourceRepository(), fixedClock))
})

describe('makeResourceTools', () => {
  it('declara escopo, flag e anotações honestas', () => {
    expect(byName('list_resources')).toMatchObject({
      scope: 'resources:read',
      flag: 'mcp.resources.read',
      annotations: { readOnlyHint: true },
    })
    expect(byName('create_resource')).toMatchObject({
      scope: 'resources:write',
      flag: 'mcp.resources.write',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    })
  })

  it('create → list devolve página com o recurso do actor', async () => {
    const actor = makeActor({ scopes: ['resources:read', 'resources:write'] })
    await byName('create_resource').handler(actor, { title: 'Pelo MCP' })
    const page = await byName('list_resources').handler(actor, { limit: 20 })
    expect(page).toMatchObject({ items: [{ title: 'Pelo MCP', ownerId: 'user-1' }], nextCursor: null })
  })

  it('a saída do list respeita o outputSchema declarado', async () => {
    const actor = makeActor({ scopes: ['resources:read'] })
    const tool = byName('list_resources')
    expect(tool.output?.safeParse(await tool.handler(actor, { limit: 5 })).success).toBe(true)
  })
})
```

Run: `npx vitest run tests/unit/resourceTools.test.ts`
Expected: FAIL (`makeResourceTools` não exportado).

- [ ] **Step 2: Implementar**

```typescript
// src/modules/resources/interfaces/mcp/tools.ts
import { defineTool, type AnyTool } from '@/shared/mcp'
import type { ResourceService } from '../../application/ResourceService'
import { createResourceSchema, listResourcesSchema } from '../../application/schemas'
import { resourceDTOSchema, resourcePageSchema, toResourcePage } from '../../application/dto'

export const makeResourceTools = (service: ResourceService): AnyTool[] => [
  defineTool({
    name: 'list_resources',
    description:
      'Lista os recursos do usuário, do mais antigo ao mais novo. Use para responder "quais são meus recursos". ' +
      'Se vier nextCursor, passe-o em cursor para a próxima página.',
    input: listResourcesSchema,
    output: resourcePageSchema,
    scope: 'resources:read',
    annotations: { readOnlyHint: true },
    flag: 'mcp.resources.read',
    handler: async (actor, input) => toResourcePage(await service.list(actor, input), input.limit),
  }),
  defineTool({
    name: 'create_resource',
    description: 'Cria um recurso do usuário com o título informado. Use quando ele pedir para criar/adicionar um recurso.',
    input: createResourceSchema,
    output: resourceDTOSchema,
    scope: 'resources:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    flag: 'mcp.resources.write',
    handler: (actor, input) => service.create(actor, input),
  }),
]
```

> `z.output<ZodTypeAny>` é `any`, então cada `defineTool(...)` é atribuível a `AnyTool` sem cast.

Acrescente ao `src/modules/resources/index.ts`:

```typescript
export { makeResourceTools } from './interfaces/mcp/tools'
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/unit/resourceTools.test.ts && npm run type-check`
Expected: PASS (3 testes).

- [ ] **Step 4: Commit**

```bash
git add src/modules/resources tests/unit/resourceTools.test.ts
git commit -m "feat(resources): tools MCP list_resources e create_resource"
```

---
### Task 20: Wiring do MCP no `composition.ts` + rotas `/api/mcp` e `/.well-known/oauth-protected-resource`

**Files:**
- Modify: `src/composition.ts`
- Create: `src/app/api/mcp/route.ts`, `src/app/.well-known/oauth-protected-resource/route.ts`
- Test: `tests/integration/mcp.route.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 10–19.
- Produces: `@/composition` passa a exportar também `personalTokens` (`InMemoryPersonalTokenStore`), `mcpRateLimiter` (60 chamadas/min por ator), `mcpAuditLog`, `mcpHandler`, `protectedResourceMetadata`. `verifierFor(config)` = `CompositeTokenVerifier(PAT, config.issuerBaseUrl ? Auth0JwtVerifier({ issuer, audience: resourceUrl }) : null)`. Com `APP_ENV=development` **e** `DEV_PERSONAL_TOKEN` definido, semeia esse PAT (`devOnly`, escopos read+write, usuário `dev-user`/`dev-tenant`).

- [ ] **Step 1: Teste de integração que falha**

```typescript
// tests/integration/mcp.route.test.ts
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
```

Run: `npx vitest run tests/integration/mcp.route.test.ts`
Expected: FAIL (`@/app/api/mcp/route` não existe).

- [ ] **Step 2: Implementar o wiring**

Substitua `src/composition.ts` por:

```typescript
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
```

```typescript
// src/app/api/mcp/route.ts
import { mcpHandler } from '@/composition'

export const POST = mcpHandler
```

```typescript
// src/app/.well-known/oauth-protected-resource/route.ts
import { protectedResourceMetadata } from '@/composition'

export const { GET } = protectedResourceMetadata
```

> `makeProtectedResourceMetadataHandler(tools, env = process.env)` lê o env **a cada** `GET`
> (o objeto `process.env` é o mesmo), então o teste pode definir as variáveis depois do import.

- [ ] **Step 3: Rodar**

Run: `npx vitest run tests/integration/mcp.route.test.ts && npm run type-check`
Expected: PASS (13 testes).

- [ ] **Step 4: Rodar o build (rota `.well-known` com ponto no nome)**

Run: `npm run build > /tmp/ws-build.log 2>&1; tail -25 /tmp/ws-build.log`
Expected: build ok, listando `/api/mcp` e `/.well-known/oauth-protected-resource`.

- [ ] **Step 5: Commit**

```bash
git add src/composition.ts src/app/api/mcp src/app/.well-known tests/integration/mcp.route.test.ts
git commit -m "feat(mcp): rota /api/mcp e metadado oauth-protected-resource no skeleton"
```

---
### Task 21: Remover o layout por camada técnica e mover a UI para `src/ui/`

**Files:**
- Delete: `src/domain/`, `src/application/`, `src/infrastructure/`
- Delete: `tests/unit/CreateResourceUseCase.test.ts`, `tests/unit/ListResourcesUseCase.test.ts`, `tests/unit/resourceGuards.test.ts`
- Move: `src/presentation/components/ResourcesView.tsx` → `src/ui/components/ResourcesView.tsx`; `src/presentation/hooks/useResources.ts` → `src/ui/hooks/useResources.ts`
- Modify: `src/ui/components/ResourcesView.tsx` (imports), `src/app/resources/page.tsx`, `src/shared/featureFlags.ts` (remover `isResourcesEnabled`), `tests/unit/featureFlags.test.ts`

**Interfaces:**
- Consumes: `createResourceSchema` via `@/modules/resources` (Task 6), `isEnabled` (Task 3).
- Produces: nenhuma referência restante a `@/domain`, `@/application`, `@/infrastructure`, `@/presentation` nem a `isResourcesEnabled`.

- [ ] **Step 1: Teste que falha** — troque o bloco `describe('isResourcesEnabled', …)` de `tests/unit/featureFlags.test.ts` (e o import dele) por:

```typescript
describe('isEnabled("resources")', () => {
  it('true quando RESOURCES_ENABLED=on', () => {
    expect(isEnabled('resources', { RESOURCES_ENABLED: 'on' })).toBe(true)
  })
  it('false quando off', () => {
    expect(isEnabled('resources', { RESOURCES_ENABLED: 'off' })).toBe(false)
  })
  it('false quando ausente (fail-closed)', () => {
    expect(isEnabled('resources', {})).toBe(false)
  })
})

describe('API legada', () => {
  it('isResourcesEnabled foi removida', async () => {
    const flags: Record<string, unknown> = await import('@/shared/featureFlags')
    expect(flags.isResourcesEnabled).toBeUndefined()
  })
})
```

Run: `npx vitest run tests/unit/featureFlags.test.ts`
Expected: FAIL só em "isResourcesEnabled foi removida".

- [ ] **Step 2: Remover o código antigo e mover a UI**

```bash
git rm -r -q src/domain src/application src/infrastructure \
  tests/unit/CreateResourceUseCase.test.ts tests/unit/ListResourcesUseCase.test.ts tests/unit/resourceGuards.test.ts
mkdir -p src/ui/components src/ui/hooks
git mv src/presentation/components/ResourcesView.tsx src/ui/components/ResourcesView.tsx
git mv src/presentation/hooks/useResources.ts src/ui/hooks/useResources.ts
```

Em `src/ui/components/ResourcesView.tsx`, troque os dois imports:

```typescript
import { useResources } from '@/ui/hooks/useResources'
import { createResourceSchema } from '@/modules/resources'
```

Substitua `src/app/resources/page.tsx`:

```typescript
import { isEnabled } from '@/shared/featureFlags'
import { ResourcesView } from '@/ui/components/ResourcesView'

export const dynamic = 'force-dynamic'

export default function ResourcesPage() {
  if (!isEnabled('resources')) {
    return <main>Funcionalidade desativada.</main>
  }
  return <ResourcesView />
}
```

Em `src/shared/featureFlags.ts`, apague a função `isResourcesEnabled` e o JSDoc `@deprecated` dela.

> **Atenção (bundle do cliente):** `ResourcesView` é `'use client'` e importa
> `@/modules/resources`. O `index.ts` do módulo reexporta service e bordas, mas o bundler só
> inclui o que é usado (`createResourceSchema` → `schemas.ts` + `zod`). Se o build acusar
> módulo de servidor no cliente (`node:crypto`, SDK MCP), registre um Ruling e importe o schema
> por um subpath público `@/modules/resources/schemas` liberado na regra de ESLint da Task 22.

- [ ] **Step 3: Conferir que nada aponta para o layout antigo**

Run: `rg -n "@/(domain|application|infrastructure|presentation)/|isResourcesEnabled" src tests || echo LIMPO`
Expected: `LIMPO`

- [ ] **Step 4: Rodar tudo**

Run: `npm test > /tmp/ws-test.log 2>&1; tail -15 /tmp/ws-test.log && npm run type-check && npm run build > /tmp/ws-build.log 2>&1; tail -20 /tmp/ws-build.log`
Expected: todos os testes passando; type-check e build ok.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "refactor(skeleton): remove camadas técnicas antigas e move UI para src/ui"
```

---

### Task 22: ESLint — fronteira de módulo (`no-restricted-imports`)

**Files:**
- Modify: `eslint.config.mjs`

**Interfaces:**
- Produces: em `src/**`, import de `@/modules/<ctx>/<qualquer coisa>` é erro de lint; exceções: `src/composition.ts` e os arquivos **dentro** do próprio módulo (que usam imports relativos). Testes (`tests/**`) ficam livres para importar internos de `domain/`/`infrastructure/`.

- [ ] **Step 1: Provar que hoje a regra não existe (teste que falha)**

```bash
mkdir -p src/tmp-lint && cat > src/tmp-lint/violation.ts <<'TS'
import { Title } from '@/modules/resources/domain/Title'
export const t = Title
TS
npx eslint src/tmp-lint/violation.ts; echo "exit=$?"
```

Expected: `exit=0` (nenhum erro — a fronteira ainda não é forçada).

- [ ] **Step 2: Acrescentar a regra** — em `eslint.config.mjs`, insira este bloco **antes** do bloco de `tests/**`:

```javascript
  {
    // Fronteira de módulo (ADR-011): fora do módulo importa-se só `@/modules/<ctx>`.
    // composition.ts é a única exceção (instancia infrastructure/).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/composition.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/*'],
              message: 'Importe só pelo index do módulo (@/modules/<ctx>). Ver ADR-011.',
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 3: Verificar a regra e limpar**

```bash
npx eslint src/tmp-lint/violation.ts; echo "exit=$?"
rm -r src/tmp-lint
npm run lint
```

Expected: 1º comando com erro `no-restricted-imports` e `exit=1`; depois `npm run lint` sem erros nem warnings (prova de que `composition.ts` e os imports relativos internos passam).

- [ ] **Step 4: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(lint): força fronteira de módulo com no-restricted-imports"
```

---
### Task 23: Documentação (env, README do skeleton, ARCHITECTURE/ADR-011, spec, guias)

**Diretório:** raiz do repositório (caminhos abaixo relativos a ela).

**Files:**
- Modify: `examples/walking-skeleton/.env.example`, `examples/walking-skeleton/README.md`
- Modify: `ARCHITECTURE.md` (remover o aviso ⚠️ das linhas 26–28), `docs/adr/011-service-layer-ddd-modular-e-perfis.md` (remover a consequência "➖ O walking skeleton fica no layout antigo…")
- Modify: `docs/superpowers/specs/2026-10-10-arquitetura-agentica-mcp-design.md` (§8 Entrega 2)
- Modify: `docs/guides/testing-guide.md`, `docs/guides/mcp-guide.md`

- [ ] **Step 1: `.env.example`** — substitua o conteúdo de `examples/walking-skeleton/.env.example`:

```bash
# Copie para .env.local (nunca commite). Ver docs/guides/mcp-guide.md.

# Marca o Dev local: libera o login stub da web e o PAT de dev. Ausente = NÃO é Dev.
APP_ENV=development

# Fatia Resources na web/REST (fail-closed: ausente = off).
RESOURCES_ENABLED=on

# Borda MCP
MCP_RESOURCE_URL=http://localhost:3000/api/mcp   # fora do Dev: https e = audience da API no Auth0
# AUTH0_ISSUER_BASE_URL=https://<tenant-uat>.auth0.com/   # sem ela, só tokens pessoais
MCP_RESOURCES_READ=on                            # padrão: on
MCP_RESOURCES_WRITE=off                          # padrão: off (ligue por ambiente, conscientemente)

# PAT de desenvolvimento (só vale com APP_ENV=development). Gere um valor seu:
#   node -e "console.log('pat_' + require('crypto').randomBytes(32).toString('base64url'))"
# DEV_PERSONAL_TOKEN=
```

- [ ] **Step 2: README do skeleton** — substitua `examples/walking-skeleton/README.md`:

````markdown
# Walking Skeleton — fatia Resources

Exemplo **autocontido** que prova o template ponta a ponta no perfil **completo**
(ADR-011): módulo `src/modules/resources/` (domínio + `ResourceService` + REST + MCP),
feature toggles e testes, sem tocar Neon/Auth0 reais (repositório in-memory, login stub
no Dev e tokens pessoais in-memory).

```
src/
├── modules/resources/{domain,application,infrastructure,interfaces/{http,mcp}}/
├── shared/{kernel,auth,mcp}/ + errors.ts, handleApiError.ts, logError.ts, featureFlags.ts
├── ui/{components,hooks}/
├── composition.ts            # único lugar que instancia infrastructure/
└── app/                      # rotas só delegam: api/resources, api/mcp, .well-known/…
```

## Rodar

```bash
npm install
cp .env.example .env.local   # APP_ENV=development, RESOURCES_ENABLED=on, MCP_*
npm run dev                  # http://localhost:3000/resources
```

## MCP local

1. Em `.env.local`, defina `DEV_PERSONAL_TOKEN` (comando no `.env.example`).
2. `npx @modelcontextprotocol/inspector` → transporte *Streamable HTTP*,
   URL `http://localhost:3000/api/mcp`, header `Authorization: Bearer <DEV_PERSONAL_TOKEN>`.
3. `tools/list` mostra `list_resources`; `create_resource` só com `MCP_RESOURCES_WRITE=on`.

Conectar o ChatGPT ao UAT (OAuth via Auth0): ver `docs/guides/mcp-guide.md`.

## Testar

```bash
npm run lint && npm run type-check && npm test && npm run build
```

## Feature toggles (ADR-006)

| Env | Padrão | Efeito |
|---|---|---|
| `RESOURCES_ENABLED` | off | página e `/api/resources` (desligado → aviso / 404) |
| `MCP_RESOURCES_READ` | on | `list_resources` |
| `MCP_RESOURCES_WRITE` | **off** | `create_resource` (precisa também do escopo `resources:write`) |

## Mapeamento de deploy (ver docs/guides/deploy-ci-guide.md)

- **PR → UAT**: preview deployment (site/celular).
- **merge na `main` → Prod**: production deployment.
- O login stub da web só existe com `APP_ENV=development`: em UAT/Prod `/api/resources`
  responde **401** até existir um `IAuthProvider` real (Auth0, ADR-004). O MCP em UAT
  funciona com OAuth do Auth0 (`AUTH0_ISSUER_BASE_URL` + `MCP_RESOURCE_URL`).
- Trocar in-memory por `NeonResourceRepository` / tabela de PATs / rate limit em Postgres
  (mesmas interfaces) quando houver infra real — ver ADRs 003, 008 e 010.
````

- [ ] **Step 3: ARCHITECTURE.md e ADR-011** — apague, em `ARCHITECTURE.md`, o bloco de 3 linhas
que começa em `> ⚠️ O exemplo em \`examples/walking-skeleton/\` ainda usa o layout por camada técnica;`
(e a linha em branco que o precede); em `docs/adr/011-service-layer-ddd-modular-e-perfis.md`,
apague o item `- ➖ O walking skeleton fica no layout antigo até a entrega 2 da spec` e a linha
de continuação `` `2026-10-10-arquitetura-agentica-mcp-design.md`. ``.

- [ ] **Step 4: Spec §8** — marque com `[x]` os quatro primeiros itens de **Entrega 2** e acrescente
ao último (ChatGPT no UAT) o sufixo ` — verificação manual pós-deploy do UAT (fora do PR).`

- [ ] **Step 5: testing-guide** — no exemplo `tests/integration/resources.route.test.ts`, acrescente
`process.env.APP_ENV = 'development'` no `beforeEach` do bloco "flag on" e `delete process.env.APP_ENV`
no `afterEach`, mais o texto, logo após o exemplo: "O login stub só existe com
`APP_ENV=development`; sem ele a rota responde 401 — teste isso também." No exemplo
`tests/integration/mcp.route.test.ts`, troque `process.env.MCP_RESOURCES_READ = 'on'` por
`process.env.APP_ENV = 'development'` e `process.env.MCP_RESOURCE_URL = 'http://localhost/api/mcp'`,
e no `afterEach` apague `APP_ENV`, `MCP_RESOURCE_URL`, `MCP_RESOURCES_READ` e `MCP_RESOURCES_WRITE`;
troque também a função `rpc` local por `import { rpc } from '../helpers/mcpRequest'`.

- [ ] **Step 6: mcp-guide** — três ajustes:
  1. §1 item 5: depois de `` `AUTH0_ISSUER_BASE_URL`, `MCP_RESOURCE_URL` (= audience). `` acrescente
     ` Fora do Dev local as duas precisam ser \`https://\`; sem \`AUTH0_ISSUER_BASE_URL\` o MCP aceita só tokens pessoais.`
  2. §2: acrescente uma coluna **Env (skeleton)** à tabela de flags com `MCP_RESOURCES_READ` e
     `MCP_RESOURCES_WRITE`, e a frase "Para demonstrar escrita no UAT, ligue `MCP_RESOURCES_WRITE=on`
     só no ambiente de UAT."
  3. §6: troque "(definido no seed)" por "(`DEV_PERSONAL_TOKEN`, semeado no boot só com
     `APP_ENV=development`)".

- [ ] **Step 7: Conferir**

Run: `rg -n "camada técnica;|layout antigo até" ARCHITECTURE.md docs/adr/011-service-layer-ddd-modular-e-perfis.md || echo LIMPO; npm run lint && npx prettier --check docs examples/walking-skeleton/README.md`
Expected: `LIMPO`; lint/format da raiz passando (rode `npx prettier --write` nos arquivos alterados se o check falhar e repita).

- [ ] **Step 8: Commit**

```bash
git add ARCHITECTURE.md docs examples/walking-skeleton/.env.example examples/walking-skeleton/README.md
git commit -m "docs: skeleton migrado para modules + MCP (env, README, guias e spec)"
```

---

### Task 24: Verificação final do exemplo

- [ ] **Step 1: Suite completa**

Run (em `examples/walking-skeleton/`):
`npm run lint > /tmp/ws-lint.log 2>&1; tail -5 /tmp/ws-lint.log; npm run type-check; npm test > /tmp/ws-test.log 2>&1; tail -15 /tmp/ws-test.log; npm run build > /tmp/ws-build.log 2>&1; tail -25 /tmp/ws-build.log`
Expected: lint sem erros/warnings; type-check ok; todos os testes passando; build lista
`/api/mcp`, `/api/resources`, `/.well-known/oauth-protected-resource` e `/resources`.

- [ ] **Step 2: Fumaça manual do MCP (dev server)**

```bash
APP_ENV=development RESOURCES_ENABLED=on MCP_RESOURCE_URL=http://localhost:3005/api/mcp \
  DEV_PERSONAL_TOKEN=pat_smoke_0123456789abcdefghijklmnopqrstuv npx next dev -p 3005 > /tmp/ws-dev.log 2>&1 &
sleep 8
curl -s -i -X POST http://localhost:3005/api/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -5
curl -s -X POST http://localhost:3005/api/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer pat_smoke_0123456789abcdefghijklmnopqrstuv' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s http://localhost:3005/.well-known/oauth-protected-resource
kill %1
```

Expected: 1º curl `HTTP/1.1 401` com `www-authenticate: Bearer resource_metadata=…`; 2º lista
`list_resources`; 3º devolve o JSON com `"resource":"http://localhost:3005/api/mcp"`.

- [ ] **Step 3: Sem commit** (só verificação). Registre o resultado no ledger.
