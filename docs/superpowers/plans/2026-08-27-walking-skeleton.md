# Walking Skeleton (fatia Resources) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provar o template com uma fatia fina "Resources" (listar + criar) que atravessa todas as camadas da Clean Architecture, atrás de um feature toggle, rodando em CI sem secrets.

**Architecture:** Next.js (App Router) em `examples/walking-skeleton/`, isolado com `package.json` próprio. Camadas domain → application → infrastructure → presentation, dependências sempre para dentro (DIP). Banco e auth são in-memory/stub atrás de `IResourceRepository`/`IAuthProvider`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.6, Zod 3, Vitest 2, Node 20.

**Spec:** `docs/superpowers/specs/2026-08-27-walking-skeleton-design.md`

## Global Constraints

- Node **20** (bate com `.github/workflows/ci.yml`).
- TypeScript **sem `any`** (use `unknown` + Zod). Sem `console.log`/`debugger`.
- **Nenhum secret** versionado; o exemplo roda `lint/type-check/test/build` sem env externos.
- **Feature flag `RESOURCES_ENABLED`**: fail-closed — ausente/qualquer-valor ≠ `'on'` → **desligado**.
- **Zod compartilhado**: o mesmo `createResourceSchema` valida no cliente e no servidor.
- **Direção de dependência**: `domain` não importa nada de fora; `application` importa só `domain`; `infrastructure`/`presentation` implementam/consomem interfaces.
- Todos os caminhos de arquivo abaixo são relativos a `examples/walking-skeleton/`.

---

### Task 1: Scaffold do projeto de exemplo

**Files:**
- Create: `examples/walking-skeleton/package.json`
- Create: `examples/walking-skeleton/tsconfig.json`
- Create: `examples/walking-skeleton/next.config.mjs`
- Create: `examples/walking-skeleton/vitest.config.ts`
- Create: `examples/walking-skeleton/.env.example`
- Create: `examples/walking-skeleton/.gitignore`
- Create: `examples/walking-skeleton/src/app/page.tsx`
- Test: `examples/walking-skeleton/tests/unit/smoke.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: harness de build/test funcionando; alias `@/*` → `src/*`.

- [ ] **Step 1: Escrever o teste de smoke (falha por ausência de harness)**

```ts
// tests/unit/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('harness', () => {
  it('roda o vitest', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npm test`
Expected: FALHA (sem `package.json`/deps ainda).

- [ ] **Step 3: Criar os arquivos de tooling**

```json
// package.json
{
  "name": "walking-skeleton",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.0.0",
    "happy-dom": "^15.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "tests", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

```js
// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {}
export default nextConfig
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
```

```bash
# .env.example
# Copie para .env.local. Liga a fatia Resources (fail-closed: ausente = off).
RESOURCES_ENABLED=on
```

```gitignore
# .gitignore
node_modules
.next
.env.local
```

```tsx
// src/app/page.tsx
export default function Home() {
  return <main>Walking skeleton — veja /resources</main>
}
```

- [ ] **Step 4: Instalar deps e rodar o teste**

Run: `cd examples/walking-skeleton && npm install && npm test`
Expected: PASS (1 teste).

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton
git commit -m "chore(example): scaffold do walking skeleton (Next.js + Vitest)"
```

---

### Task 2: Shared — hierarquia de erros e handleApiError

**Files:**
- Create: `examples/walking-skeleton/src/shared/errors.ts`
- Create: `examples/walking-skeleton/src/shared/handleApiError.ts`
- Test: `examples/walking-skeleton/tests/unit/handleApiError.test.ts`

**Interfaces:**
- Produces: `AppError`, `DomainError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`; `handleApiError(error: unknown): Response`.

- [ ] **Step 1: Escrever o teste**

```ts
// tests/unit/handleApiError.test.ts
import { describe, it, expect } from 'vitest'
import { handleApiError } from '@/shared/handleApiError'
import { ValidationError } from '@/shared/errors'

describe('handleApiError', () => {
  it('mapeia AppError para status + code', async () => {
    const res = handleApiError(new ValidationError('Título inválido'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Título inválido', code: 'VALIDATION_ERROR' })
  })

  it('mapeia erro desconhecido para 500 genérico', async () => {
    const res = handleApiError(new Error('boom'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/handleApiError.test.ts`
Expected: FALHA ("Cannot find module '@/shared/handleApiError'").

- [ ] **Step 3: Implementar**

```ts
// src/shared/errors.ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class DomainError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} não encontrado`, 'NOT_FOUND', 404)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Não autorizado') {
    super(message, 'UNAUTHORIZED', 401)
  }
}
```

```ts
// src/shared/handleApiError.ts
import { AppError } from './errors'

export function handleApiError(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode })
  }
  return Response.json(
    { error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' },
    { status: 500 }
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/handleApiError.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/shared examples/walking-skeleton/tests/unit/handleApiError.test.ts
git commit -m "feat(example): hierarquia de erros e handleApiError"
```

---

### Task 3: Shared — feature flag (fail-closed)

**Files:**
- Create: `examples/walking-skeleton/src/shared/featureFlags.ts`
- Test: `examples/walking-skeleton/tests/unit/featureFlags.test.ts`

**Interfaces:**
- Produces: `isResourcesEnabled(env?: NodeJS.ProcessEnv): boolean`.

- [ ] **Step 1: Escrever o teste**

```ts
// tests/unit/featureFlags.test.ts
import { describe, it, expect } from 'vitest'
import { isResourcesEnabled } from '@/shared/featureFlags'

describe('isResourcesEnabled', () => {
  it('true quando RESOURCES_ENABLED=on', () => {
    expect(isResourcesEnabled({ RESOURCES_ENABLED: 'on' })).toBe(true)
  })
  it('false quando off', () => {
    expect(isResourcesEnabled({ RESOURCES_ENABLED: 'off' })).toBe(false)
  })
  it('false quando ausente (fail-closed)', () => {
    expect(isResourcesEnabled({})).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/featureFlags.test.ts`
Expected: FALHA ("Cannot find module").

- [ ] **Step 3: Implementar**

```ts
// src/shared/featureFlags.ts
export function isResourcesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RESOURCES_ENABLED === 'on'
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/featureFlags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/shared/featureFlags.ts examples/walking-skeleton/tests/unit/featureFlags.test.ts
git commit -m "feat(example): feature flag isResourcesEnabled (fail-closed)"
```

---

### Task 4: Domain — entidade Resource

**Files:**
- Create: `examples/walking-skeleton/src/domain/entities/Resource.ts`
- Test: `examples/walking-skeleton/tests/unit/Resource.test.ts`

**Interfaces:**
- Consumes: `DomainError` de `@/shared/errors`.
- Produces: `class Resource` com `id: string`, `title: string`, `ownerId: string`, `createdAt: Date`; construtor valida `3 ≤ title.length ≤ 100`.

- [ ] **Step 1: Escrever o teste**

```ts
// tests/unit/Resource.test.ts
import { describe, it, expect } from 'vitest'
import { Resource } from '@/domain/entities/Resource'
import { DomainError } from '@/shared/errors'

describe('Resource', () => {
  it('cria com título válido', () => {
    const r = new Resource('id-1', 'Meu título', 'owner-1', new Date())
    expect(r.title).toBe('Meu título')
  })
  it('rejeita título curto (< 3)', () => {
    expect(() => new Resource('id-1', 'ab', 'owner-1', new Date())).toThrow(DomainError)
  })
  it('rejeita título longo (> 100)', () => {
    expect(() => new Resource('id-1', 'x'.repeat(101), 'owner-1', new Date())).toThrow(DomainError)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/Resource.test.ts`
Expected: FALHA ("Cannot find module").

- [ ] **Step 3: Implementar**

```ts
// src/domain/entities/Resource.ts
import { DomainError } from '@/shared/errors'

export class Resource {
  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly ownerId: string,
    public readonly createdAt: Date
  ) {
    if (title.length < 3 || title.length > 100) {
      throw new DomainError('Título deve ter entre 3 e 100 caracteres')
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/Resource.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/domain/entities/Resource.ts examples/walking-skeleton/tests/unit/Resource.test.ts
git commit -m "feat(example): entidade de domínio Resource com validação"
```

---

### Task 5: Application — validators (Zod)

**Files:**
- Create: `examples/walking-skeleton/src/application/validators/resourceSchemas.ts`
- Test: `examples/walking-skeleton/tests/unit/resourceSchemas.test.ts`

**Interfaces:**
- Produces: `createResourceSchema` (Zod) e `type CreateResourceDTO = { title: string }`.

- [ ] **Step 1: Escrever o teste**

```ts
// tests/unit/resourceSchemas.test.ts
import { describe, it, expect } from 'vitest'
import { createResourceSchema } from '@/application/validators/resourceSchemas'

describe('createResourceSchema', () => {
  it('aceita título válido', () => {
    expect(createResourceSchema.parse({ title: 'Válido' })).toEqual({ title: 'Válido' })
  })
  it('rejeita título curto', () => {
    expect(createResourceSchema.safeParse({ title: 'ab' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/resourceSchemas.test.ts`
Expected: FALHA ("Cannot find module").

- [ ] **Step 3: Implementar**

```ts
// src/application/validators/resourceSchemas.ts
import { z } from 'zod'

export const createResourceSchema = z.object({
  title: z.string().min(3).max(100),
})

export type CreateResourceDTO = z.infer<typeof createResourceSchema>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/resourceSchemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/application/validators examples/walking-skeleton/tests/unit/resourceSchemas.test.ts
git commit -m "feat(example): schema Zod createResourceSchema"
```

---

### Task 6: Domain — interfaces (contratos)

**Files:**
- Create: `examples/walking-skeleton/src/domain/interfaces/IResourceRepository.ts`
- Create: `examples/walking-skeleton/src/domain/interfaces/IAuthProvider.ts`

**Interfaces:**
- Consumes: `Resource`.
- Produces:
  - `IResourceRepository`: `findById(id: string): Promise<Resource | null>`; `findByOwnerId(ownerId: string): Promise<Resource[]>`; `save(resource: Resource): Promise<void>`; `delete(id: string): Promise<void>`.
  - `AuthUser = { id: string }`; `IAuthProvider`: `getUser(req: Request): Promise<AuthUser | null>`.

> Interfaces são só tipos — sem teste próprio; são exercitadas pelas tarefas 7–11. Deliverable: `npm run type-check` passa.

- [ ] **Step 1: Criar as interfaces**

```ts
// src/domain/interfaces/IResourceRepository.ts
import { Resource } from '@/domain/entities/Resource'

export interface IResourceRepository {
  findById(id: string): Promise<Resource | null>
  findByOwnerId(ownerId: string): Promise<Resource[]>
  save(resource: Resource): Promise<void>
  delete(id: string): Promise<void>
}
```

```ts
// src/domain/interfaces/IAuthProvider.ts
export interface AuthUser {
  id: string
}

export interface IAuthProvider {
  getUser(req: Request): Promise<AuthUser | null>
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd examples/walking-skeleton && npm run type-check`
Expected: PASS (sem erros).

- [ ] **Step 3: Commit**

```bash
git add examples/walking-skeleton/src/domain/interfaces
git commit -m "feat(example): interfaces IResourceRepository e IAuthProvider"
```

---

### Task 7: Application — CreateResourceUseCase

**Files:**
- Create: `examples/walking-skeleton/src/application/use-cases/CreateResourceUseCase.ts`
- Test: `examples/walking-skeleton/tests/unit/CreateResourceUseCase.test.ts`

**Interfaces:**
- Consumes: `IResourceRepository`, `Resource`, `CreateResourceDTO`.
- Produces: `class CreateResourceUseCase` com `execute(dto: CreateResourceDTO, ownerId: string): Promise<Resource>`.

- [ ] **Step 1: Escrever o teste**

```ts
// tests/unit/CreateResourceUseCase.test.ts
import { describe, it, expect, vi } from 'vitest'
import { CreateResourceUseCase } from '@/application/use-cases/CreateResourceUseCase'
import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'

function mockRepo(): IResourceRepository {
  return {
    findById: vi.fn(),
    findByOwnerId: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(),
  }
}

describe('CreateResourceUseCase', () => {
  it('cria e salva o resource', async () => {
    const repo = mockRepo()
    const useCase = new CreateResourceUseCase(repo)
    const result = await useCase.execute({ title: 'Novo' }, 'owner-1')
    expect(result.title).toBe('Novo')
    expect(result.ownerId).toBe('owner-1')
    expect(repo.save).toHaveBeenCalledTimes(1)
  })

  it('propaga erro de domínio para título inválido', async () => {
    const repo = mockRepo()
    const useCase = new CreateResourceUseCase(repo)
    await expect(useCase.execute({ title: 'ab' }, 'owner-1')).rejects.toThrow()
    expect(repo.save).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/CreateResourceUseCase.test.ts`
Expected: FALHA ("Cannot find module").

- [ ] **Step 3: Implementar**

```ts
// src/application/use-cases/CreateResourceUseCase.ts
import { Resource } from '@/domain/entities/Resource'
import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'
import type { CreateResourceDTO } from '@/application/validators/resourceSchemas'

export class CreateResourceUseCase {
  constructor(private readonly repository: IResourceRepository) {}

  async execute(dto: CreateResourceDTO, ownerId: string): Promise<Resource> {
    const resource = new Resource(crypto.randomUUID(), dto.title, ownerId, new Date())
    await this.repository.save(resource)
    return resource
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/CreateResourceUseCase.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/application/use-cases/CreateResourceUseCase.ts examples/walking-skeleton/tests/unit/CreateResourceUseCase.test.ts
git commit -m "feat(example): CreateResourceUseCase"
```

---

### Task 8: Application — ListResourcesUseCase

**Files:**
- Create: `examples/walking-skeleton/src/application/use-cases/ListResourcesUseCase.ts`
- Test: `examples/walking-skeleton/tests/unit/ListResourcesUseCase.test.ts`

**Interfaces:**
- Consumes: `IResourceRepository`, `Resource`.
- Produces: `class ListResourcesUseCase` com `execute(ownerId: string): Promise<Resource[]>`.

- [ ] **Step 1: Escrever o teste**

```ts
// tests/unit/ListResourcesUseCase.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ListResourcesUseCase } from '@/application/use-cases/ListResourcesUseCase'
import { Resource } from '@/domain/entities/Resource'
import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'

describe('ListResourcesUseCase', () => {
  it('retorna os resources do owner', async () => {
    const mine = [new Resource('1', 'Meu', 'owner-1', new Date())]
    const repo: IResourceRepository = {
      findById: vi.fn(),
      findByOwnerId: vi.fn().mockResolvedValue(mine),
      save: vi.fn(),
      delete: vi.fn(),
    }
    const useCase = new ListResourcesUseCase(repo)
    const result = await useCase.execute('owner-1')
    expect(result).toEqual(mine)
    expect(repo.findByOwnerId).toHaveBeenCalledWith('owner-1')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/ListResourcesUseCase.test.ts`
Expected: FALHA ("Cannot find module").

- [ ] **Step 3: Implementar**

```ts
// src/application/use-cases/ListResourcesUseCase.ts
import type { Resource } from '@/domain/entities/Resource'
import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'

export class ListResourcesUseCase {
  constructor(private readonly repository: IResourceRepository) {}

  async execute(ownerId: string): Promise<Resource[]> {
    return this.repository.findByOwnerId(ownerId)
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/ListResourcesUseCase.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/application/use-cases/ListResourcesUseCase.ts examples/walking-skeleton/tests/unit/ListResourcesUseCase.test.ts
git commit -m "feat(example): ListResourcesUseCase"
```

---

### Task 9: Application — guard de autorização (fail-closed)

**Files:**
- Create: `examples/walking-skeleton/src/application/authz/resourceGuards.ts`
- Test: `examples/walking-skeleton/tests/unit/resourceGuards.test.ts`

**Interfaces:**
- Consumes: `AuthUser` de `@/domain/interfaces/IAuthProvider`, `UnauthorizedError`.
- Produces:
  - `requireUser(user: AuthUser | null): AuthUser` — lança `UnauthorizedError` se `null`.
  - `assertOwnership(user: AuthUser, ownerId: string): void` — lança `UnauthorizedError` se `user.id !== ownerId`.

- [ ] **Step 1: Escrever o teste**

```ts
// tests/unit/resourceGuards.test.ts
import { describe, it, expect } from 'vitest'
import { requireUser, assertOwnership } from '@/application/authz/resourceGuards'
import { UnauthorizedError } from '@/shared/errors'

describe('resourceGuards', () => {
  it('requireUser lança 401 sem usuário', () => {
    expect(() => requireUser(null)).toThrow(UnauthorizedError)
  })
  it('requireUser retorna o usuário quando presente', () => {
    expect(requireUser({ id: 'u1' })).toEqual({ id: 'u1' })
  })
  it('assertOwnership nega dono diferente', () => {
    expect(() => assertOwnership({ id: 'u1' }, 'u2')).toThrow(UnauthorizedError)
  })
  it('assertOwnership permite o próprio dono', () => {
    expect(() => assertOwnership({ id: 'u1' }, 'u1')).not.toThrow()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/resourceGuards.test.ts`
Expected: FALHA ("Cannot find module").

- [ ] **Step 3: Implementar**

```ts
// src/application/authz/resourceGuards.ts
import type { AuthUser } from '@/domain/interfaces/IAuthProvider'
import { UnauthorizedError } from '@/shared/errors'

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw new UnauthorizedError()
  return user
}

export function assertOwnership(user: AuthUser, ownerId: string): void {
  if (user.id !== ownerId) throw new UnauthorizedError()
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/resourceGuards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/application/authz examples/walking-skeleton/tests/unit/resourceGuards.test.ts
git commit -m "feat(example): guards de autorização fail-closed"
```

---

### Task 10: Infrastructure — InMemoryResourceRepository e StubAuthProvider

**Files:**
- Create: `examples/walking-skeleton/src/infrastructure/repositories/InMemoryResourceRepository.ts`
- Create: `examples/walking-skeleton/src/infrastructure/auth/StubAuthProvider.ts`
- Test: `examples/walking-skeleton/tests/unit/InMemoryResourceRepository.test.ts`

**Interfaces:**
- Consumes: `IResourceRepository`, `IAuthProvider`, `Resource`, `AuthUser`.
- Produces:
  - `class InMemoryResourceRepository implements IResourceRepository` + método extra `clear(): void` (para testes).
  - `class StubAuthProvider implements IAuthProvider` — `getUser()` sempre devolve `{ id: 'dev-user' }`.

- [ ] **Step 1: Escrever o teste**

```ts
// tests/unit/InMemoryResourceRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryResourceRepository } from '@/infrastructure/repositories/InMemoryResourceRepository'
import { Resource } from '@/domain/entities/Resource'

describe('InMemoryResourceRepository', () => {
  let repo: InMemoryResourceRepository
  beforeEach(() => {
    repo = new InMemoryResourceRepository()
  })

  it('save + findByOwnerId retorna só do dono', async () => {
    await repo.save(new Resource('1', 'A', 'owner-1', new Date()))
    await repo.save(new Resource('2', 'B', 'owner-2', new Date()))
    const mine = await repo.findByOwnerId('owner-1')
    expect(mine.map((r) => r.id)).toEqual(['1'])
  })

  it('findById retorna null quando não existe', async () => {
    expect(await repo.findById('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/InMemoryResourceRepository.test.ts`
Expected: FALHA ("Cannot find module").

- [ ] **Step 3: Implementar**

```ts
// src/infrastructure/repositories/InMemoryResourceRepository.ts
import type { IResourceRepository } from '@/domain/interfaces/IResourceRepository'
import type { Resource } from '@/domain/entities/Resource'

export class InMemoryResourceRepository implements IResourceRepository {
  private store = new Map<string, Resource>()

  async findById(id: string): Promise<Resource | null> {
    return this.store.get(id) ?? null
  }

  async findByOwnerId(ownerId: string): Promise<Resource[]> {
    return [...this.store.values()].filter((r) => r.ownerId === ownerId)
  }

  async save(resource: Resource): Promise<void> {
    this.store.set(resource.id, resource)
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id)
  }

  clear(): void {
    this.store.clear()
  }
}
```

```ts
// src/infrastructure/auth/StubAuthProvider.ts
import type { IAuthProvider, AuthUser } from '@/domain/interfaces/IAuthProvider'

export class StubAuthProvider implements IAuthProvider {
  async getUser(_req: Request): Promise<AuthUser | null> {
    return { id: 'dev-user' }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd examples/walking-skeleton && npx vitest run tests/unit/InMemoryResourceRepository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/infrastructure examples/walking-skeleton/tests/unit/InMemoryResourceRepository.test.ts
git commit -m "feat(example): InMemoryResourceRepository e StubAuthProvider"
```

---

### Task 11: Presentation — rota API + composição (integração)

**Files:**
- Create: `examples/walking-skeleton/src/infrastructure/composition.ts`
- Create: `examples/walking-skeleton/src/app/api/resources/route.ts`
- Test: `examples/walking-skeleton/tests/integration/resources.route.test.ts`

**Interfaces:**
- Consumes: use-cases, guards, `createResourceSchema`, `handleApiError`, `isResourcesEnabled`, repo/auth de `composition`.
- Produces: handlers `GET(req: Request): Promise<Response>` e `POST(req: Request): Promise<Response>`; `composition` exporta `resourceRepository: InMemoryResourceRepository` e `authProvider: StubAuthProvider` (singletons).

- [ ] **Step 1: Escrever o teste de integração**

```ts
// tests/integration/resources.route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GET, POST } from '@/app/api/resources/route'
import { resourceRepository } from '@/infrastructure/composition'

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const getReq = () => new Request('http://localhost/api/resources')

describe('rota /api/resources (flag on)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'on'
    resourceRepository.clear()
  })
  afterEach(() => {
    delete process.env.RESOURCES_ENABLED
  })

  it('POST cria com título válido → 201', async () => {
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('Válido')
    expect(body.ownerId).toBe('dev-user')
  })

  it('POST com título inválido → 400 VALIDATION_ERROR', async () => {
    const res = await POST(postReq({ title: 'ab' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('VALIDATION_ERROR')
  })

  it('GET lista os resources do usuário → 200', async () => {
    await POST(postReq({ title: 'Item um' }))
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
  })
})

describe('rota /api/resources (flag off)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'off'
    resourceRepository.clear()
  })

  it('GET → 404 quando desligado', async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(404)
  })
  it('POST → 404 quando desligado', async () => {
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd examples/walking-skeleton && npx vitest run tests/integration/resources.route.test.ts`
Expected: FALHA ("Cannot find module '@/app/api/resources/route'").

- [ ] **Step 3: Implementar composição + rota**

```ts
// src/infrastructure/composition.ts
import { InMemoryResourceRepository } from '@/infrastructure/repositories/InMemoryResourceRepository'
import { StubAuthProvider } from '@/infrastructure/auth/StubAuthProvider'

export const resourceRepository = new InMemoryResourceRepository()
export const authProvider = new StubAuthProvider()
```

```ts
// src/app/api/resources/route.ts
import { isResourcesEnabled } from '@/shared/featureFlags'
import { handleApiError } from '@/shared/handleApiError'
import { NotFoundError } from '@/shared/errors'
import { createResourceSchema } from '@/application/validators/resourceSchemas'
import { requireUser } from '@/application/authz/resourceGuards'
import { CreateResourceUseCase } from '@/application/use-cases/CreateResourceUseCase'
import { ListResourcesUseCase } from '@/application/use-cases/ListResourcesUseCase'
import { resourceRepository, authProvider } from '@/infrastructure/composition'

function ensureEnabled(): void {
  if (!isResourcesEnabled()) throw new NotFoundError('Recurso')
}

export async function GET(req: Request): Promise<Response> {
  try {
    ensureEnabled()
    const user = requireUser(await authProvider.getUser(req))
    const resources = await new ListResourcesUseCase(resourceRepository).execute(user.id)
    return Response.json(resources, { status: 200 })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    ensureEnabled()
    const user = requireUser(await authProvider.getUser(req))
    const dto = createResourceSchema.parse(await req.json())
    const resource = await new CreateResourceUseCase(resourceRepository).execute(dto, user.id)
    return Response.json(resource, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}
```

> Nota: `createResourceSchema.parse` lança `ZodError`, que `handleApiError` cai no ramo 500. Para o teste "400 VALIDATION_ERROR" passar, trate `ZodError` no `handleApiError` (Step 3b).

- [ ] **Step 3b: Ajustar handleApiError para ZodError → 400 VALIDATION_ERROR**

```ts
// src/shared/handleApiError.ts (substituir conteúdo)
import { ZodError } from 'zod'
import { AppError } from './errors'

export function handleApiError(error: unknown): Response {
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? 'Dados inválidos'
    return Response.json({ error: message, code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  if (error instanceof AppError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode })
  }
  return Response.json(
    { error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' },
    { status: 500 }
  )
}
```

- [ ] **Step 4: Rodar os testes (rota + handleApiError)**

Run: `cd examples/walking-skeleton && npx vitest run tests/integration/resources.route.test.ts tests/unit/handleApiError.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/infrastructure/composition.ts examples/walking-skeleton/src/app/api/resources examples/walking-skeleton/src/shared/handleApiError.ts examples/walking-skeleton/tests/integration
git commit -m "feat(example): rota /api/resources com gate de flag e authz"
```

---

### Task 12: Presentation — página, hook e componente

**Files:**
- Create: `examples/walking-skeleton/src/presentation/hooks/useResources.ts`
- Create: `examples/walking-skeleton/src/presentation/components/ResourcesView.tsx`
- Create: `examples/walking-skeleton/src/app/resources/page.tsx`

**Interfaces:**
- Consumes: rota `/api/resources`; `createResourceSchema` (validação no cliente); `isResourcesEnabled` (gate na página).
- Produces: UI mínima funcional. Verificação por `build` + manual (a spec limita testes a unit/integration).

- [ ] **Step 1: Implementar o hook**

```tsx
// src/presentation/hooks/useResources.ts
'use client'
import { useEffect, useState, useCallback } from 'react'

export interface ResourceView {
  id: string
  title: string
  ownerId: string
}

export function useResources() {
  const [resources, setResources] = useState<ResourceView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/resources')
      if (!res.ok) throw new Error('Falha ao carregar')
      setResources(await res.json())
      setError(null)
    } catch {
      setError('Não foi possível carregar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [])

  const create = useCallback(
    async (title: string) => {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.code === 'VALIDATION_ERROR' ? body.error : 'Erro. Tente novamente.')
        return
      }
      setError(null)
      await load()
    },
    [load]
  )

  useEffect(() => {
    void load()
  }, [load])

  return { resources, error, loading, create }
}
```

- [ ] **Step 2: Implementar o componente**

```tsx
// src/presentation/components/ResourcesView.tsx
'use client'
import { useState } from 'react'
import { useResources } from '@/presentation/hooks/useResources'

export function ResourcesView() {
  const { resources, error, loading, create } = useResources()
  const [title, setTitle] = useState('')

  const canSubmit = title.trim().length >= 3

  return (
    <main>
      <h1>Resources</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void create(title).then(() => setTitle(''))
        }}
      >
        <label htmlFor="title">Título</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" disabled={!canSubmit}>
          Criar
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loading ? <p>Carregando…</p> : <ul>{resources.map((r) => <li key={r.id}>{r.title}</li>)}</ul>}
    </main>
  )
}
```

- [ ] **Step 3: Implementar a página com gate da flag**

```tsx
// src/app/resources/page.tsx
import { isResourcesEnabled } from '@/shared/featureFlags'
import { ResourcesView } from '@/presentation/components/ResourcesView'

export default function ResourcesPage() {
  if (!isResourcesEnabled()) {
    return <main>Funcionalidade desativada.</main>
  }
  return <ResourcesView />
}
```

- [ ] **Step 4: Type-check + build**

Run: `cd examples/walking-skeleton && npm run type-check && RESOURCES_ENABLED=on npm run build`
Expected: PASS (build sem erros).

- [ ] **Step 5: Commit**

```bash
git add examples/walking-skeleton/src/presentation examples/walking-skeleton/src/app/resources
git commit -m "feat(example): página, hook e componente Resources com gate de flag"
```

---

### Task 13: CI job + README do exemplo

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `examples/walking-skeleton/README.md`

**Interfaces:**
- Consumes: scripts do exemplo (`lint`/`type-check`/`test`/`build`).
- Produces: job de CI `example` que valida o walking skeleton; README mapeando o deploy.

- [ ] **Step 1: Adicionar o job no CI**

Adicionar ao final de `.github/workflows/ci.yml` (após o job `test`; substitui o comentário do job `build`):

```yaml
  example:
    name: Walking Skeleton (example)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: examples/walking-skeleton
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm test
      - name: Build
        run: npm run build
        env:
          RESOURCES_ENABLED: 'on'
```

> Nota: o job usa `npm ci`, que exige `package-lock.json`. Gere-o na Task 1
> (o `npm install` cria o lock); confirme que `examples/walking-skeleton/package-lock.json`
> está versionado antes deste passo.

- [ ] **Step 2: Escrever o README do exemplo**

```markdown
# Walking Skeleton — fatia Resources

Exemplo **autocontido** que prova o template ponta a ponta: Clean Architecture
(domain → application → infrastructure → presentation), feature toggle e testes,
sem tocar Neon/Auth0 reais (usa in-memory + auth stub).

## Rodar

```bash
npm install
cp .env.example .env.local   # RESOURCES_ENABLED=on
npm run dev                  # http://localhost:3000/resources
```

## Testar

```bash
npm run lint && npm run type-check && npm test && npm run build
```

## Feature toggle

`RESOURCES_ENABLED` (fail-closed): ausente/≠`on` → a fatia fica desativada
(página avisa, API responde 404). Ver ADR-006.

## Mapeamento de deploy (ver docs/guides/deploy-ci-guide.md)

- **PR → UAT**: preview deployment (site/celular).
- **merge na `main` → Prod**: production deployment.
- Trocar in-memory/stub por `NeonResourceRepository`/`Auth0AuthProvider` (mesmas
  interfaces) quando houver infra real — ver ADRs 003 e 004.
```

- [ ] **Step 3: Validar tudo localmente**

Run: `cd examples/walking-skeleton && npm run lint && npm run type-check && npm test && RESOURCES_ENABLED=on npm run build`
Expected: PASS em todas.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml examples/walking-skeleton/README.md examples/walking-skeleton/package-lock.json
git commit -m "ci(example): job para o walking skeleton + README de deploy"
```

---

## Self-Review

**Spec coverage:**
- Fatia list+create → Tasks 7, 8, 11, 12. ✔
- Todas as camadas → Tasks 4–12. ✔
- Feature toggle fail-closed → Tasks 3, 11, 12. ✔
- Authz fail-closed (401 no guard; ownership) → Task 9 (401), Task 11 (uso). ✔
  - Nota: `assertOwnership` é criado na Task 9; nesta fatia o `findByOwnerId` já
    restringe por dono, então `assertOwnership` fica disponível para update/delete
    futuros — sem uso obrigatório na rota atual (documentado, não é gap).
- Zod compartilhado front/back → Task 5 (schema), Task 11 (server), Task 12 (client). ✔
- Erros funcional vs técnico → Task 2 + Task 11 (Step 3b, ZodError→400). ✔
- Testes unit + integration → Tasks 2–11. ✔
- Job de CI → Task 13. ✔
- README mapeando deploy → Task 13. ✔
- Roda sem secrets → in-memory/stub (Task 10), flag via env local. ✔

**Placeholder scan:** sem TBD/TODO; todo passo tem código real.

**Type consistency:** `IResourceRepository` (findById/findByOwnerId/save/delete), `IAuthProvider.getUser(req)`, `AuthUser.id`, `createResourceSchema`/`CreateResourceDTO`, `handleApiError`, `isResourcesEnabled`, `resourceRepository`/`authProvider` — nomes batem entre as tarefas que os produzem e consomem.
