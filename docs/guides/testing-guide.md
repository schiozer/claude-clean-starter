# Guia de Testes

**Última Atualização**: 2026-10-10
**Versão**: 3.0.0

---

## Visão Geral

Este guia é **auto-contido**: todo padrão citado tem um teste equivalente em
`examples/walking-skeleton/tests/`. As ferramentas do starter:

- **Vitest** — testes unitários e de integração.
- **happy-dom** — DOM leve para componentes/hooks (mais rápido que jsdom).
- **Testing Library** — testes de componentes React (quando houver UI a testar).
- **Playwright** — E2E, opcional (entra quando a UI estabiliza).

A arquitetura por módulos com **`<Ctx>Service` como porta única**
([ADR-011](../adr/011-service-layer-ddd-modular-e-perfis.md)) é o que torna o teste
barato: regra e autorização vivem no service, que recebe o `actor` e dependências por
construtor. A maior parte é teste unitário de Value Object/aggregate + service com um
**repositório in-memory**; as bordas (REST e MCP) ganham poucos testes de integração.

---

## Pirâmide de Testes

```
        /\
       /E2E\      ← poucos, lentos, alta confiança (Playwright, opcional)
      /------\
     / Integ. \   ← bordas: rota REST e /api/mcp (Request → Response)
    /----------\
   / Unit Tests \ ← muitos, rápidos: VOs, aggregates, services, guards, schemas
  /--------------\
```

O starter já traz as duas camadas de baixo prontas; E2E entra quando a UI estabiliza.

---

## Setup

O skeleton já vem configurado. A config é mínima e **não** usa jsdom nem chaves de
banco de teste:

```typescript
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

> **Variáveis de ambiente em teste.** Não semeie chaves de banco globalmente. Quando
> um teste depende de um flag/segredo, defina-o **no próprio teste** (`beforeEach`) e
> limpe no `afterEach` — ver os testes de borda abaixo. Isso mantém os testes isolados
> e evita drift com o contrato real de env.

### Helpers de teste

Dois helpers evitam repetição e deixam explícito **quem** está agindo e **quando**:

```typescript
// tests/helpers/makeActor.ts
import type { AuthUser } from '@/shared/auth'

export function makeActor(overrides: Partial<AuthUser> = {}): AuthUser {
  return { id: 'user-1', tenantId: 'tenant-1', scopes: [], via: 'session', ...overrides }
}

// tests/helpers/fixedClock.ts
import type { Clock } from '@/shared/kernel'

export const fixedClock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') }
```

`makeActor()` nasce **sem escopos** de propósito: cada teste declara o escopo que precisa
(`makeActor({ scopes: ['resources:write'] })`), e esquecer de declarar falha — o mesmo
fail-closed da produção.

---

## Testes Unitários

**TESTE:** Value Objects e aggregates (invariantes), services (escopo, posse, isolamento
por owner, DTO de saída), guards, schemas Zod, edge cases (`null`/`undefined`/vazio).

**NÃO TESTE (ainda):** componentes puramente visuais, getters triviais, e o SDK do banco
em si (o service fala com a **interface** do repositório, não com o driver).

### Padrão AAA (Arrange, Act, Assert)

```typescript
// tests/unit/Title.test.ts
import { describe, it, expect } from 'vitest'
import { Title } from '@/modules/resources/domain/Title'
import { DomainError } from '@/shared/errors'

describe('Title', () => {
  it('rejeita título com menos de 3 caracteres', () => {
    // Arrange + Act + Assert
    expect(() => Title.of('ab')).toThrow(DomainError)
  })

  it('normaliza espaços nas pontas', () => {
    expect(Title.of('  Meu recurso  ').value).toBe('Meu recurso')
  })
})
```

> Testes de `domain/` importam o arquivo interno do módulo — é o único lugar onde isso é
> aceitável. Código de produção fora do módulo importa **só** `@/modules/resources`
> (ESLint `no-restricted-imports`).

### Validações Zod

```typescript
// tests/unit/resourceSchemas.test.ts
import { describe, it, expect } from 'vitest'
import { createResourceSchema, listResourcesSchema } from '@/modules/resources'

describe('createResourceSchema', () => {
  it('aceita título válido', () => {
    expect(createResourceSchema.safeParse({ title: 'Válido' }).success).toBe(true)
  })

  it('rejeita título curto', () => {
    expect(createResourceSchema.safeParse({ title: 'ab' }).success).toBe(false)
  })
})

describe('listResourcesSchema', () => {
  it('limita a página a 50 itens', () => {
    expect(listResourcesSchema.safeParse({ limit: 51 }).success).toBe(false)
  })
})
```

### Service: repositório in-memory + `actor` explícito

Este é o padrão central do starter. O `ResourceService` recebe um `IResourceRepository` e
um `Clock` por construtor; no teste você injeta o `InMemoryResourceRepository` e o
`fixedClock` — nenhum banco envolvido. Todo teste passa o **`actor`** como 1º argumento,
como a borda faria.

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

  beforeEach(() => {
    repo = new InMemoryResourceRepository()
    service = new ResourceService(repo, fixedClock)
  })

  it('cria o recurso com owner e tenant derivados do actor', async () => {
    const actor = makeActor({ scopes: ['resources:write'] })
    const dto = await service.create(actor, { title: 'Novo' })
    expect(dto).toMatchObject({ title: 'Novo', ownerId: 'user-1' })
  })

  it('sem escopo de escrita → ForbiddenError e NÃO salva', async () => {
    const saveSpy = vi.spyOn(repo, 'save')
    await expect(service.create(makeActor(), { title: 'Novo' })).rejects.toThrow(ForbiddenError)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('título inválido → DomainError e NÃO salva', async () => {
    const saveSpy = vi.spyOn(repo, 'save')
    const actor = makeActor({ scopes: ['resources:write'] })
    await expect(service.create(actor, { title: 'ab' })).rejects.toThrow(DomainError)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('list devolve só os recursos do próprio actor', async () => {
    const write = ['resources:write']
    await service.create(makeActor({ id: 'ana', scopes: write }), { title: 'Da Ana' })
    await service.create(makeActor({ id: 'bia', scopes: write }), { title: 'Da Bia' })

    const result = await service.list(makeActor({ id: 'ana', scopes: ['resources:read'] }), {
      limit: 20,
    })

    expect(result.map((r) => r.title)).toEqual(['Da Ana'])
  })

  it('o DTO não vaza campos internos (ex.: tenantId)', async () => {
    const dto = await service.create(makeActor({ scopes: ['resources:write'] }), { title: 'Novo' })
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'id', 'ownerId', 'title'])
  })
})
```

Repare nos testes de erro: além do `throw`, eles afirmam que `save` **não** foi chamado —
o guard e a regra falham **antes** de tocar a persistência. Testar o "não-efeito" é tão
importante quanto testar o efeito.

> **Perfil MVP.** No `mvp-primeiro` não há repositório: o service recebe o cliente do
> banco (ou um fake dele) por construtor. Os testes têm a **mesma forma** — `actor`
> primeiro, escopo ausente → erro, isolamento por owner — e continuam passando quando o
> projeto for promovido.

### Guards (autorização fail-closed)

```typescript
// tests/unit/guards.test.ts
import { describe, it, expect } from 'vitest'
import { requireScope, assertOwnership } from '@/shared/auth'
import { ForbiddenError } from '@/shared/errors'
import { makeActor } from '../helpers/makeActor'

describe('requireScope', () => {
  it('lança ForbiddenError quando o escopo não está no actor', () => {
    expect(() => requireScope(makeActor(), 'resources:read')).toThrow(ForbiddenError)
  })

  it('passa quando o escopo está presente', () => {
    expect(() =>
      requireScope(makeActor({ scopes: ['resources:read'] }), 'resources:read')
    ).not.toThrow()
  })
})

describe('assertOwnership', () => {
  it('lança ForbiddenError quando o recurso é de outro usuário', () => {
    expect(() => assertOwnership(makeActor({ id: 'ana' }), 'bia')).toThrow(ForbiddenError)
  })
})
```

---

## Testes de Integração — Bordas

As bordas são finas, então o teste de integração delas responde só a três perguntas:
**(1)** a identidade é resolvida (ou recusada com 401)? **(2)** o input é validado e o
service é chamado? **(3)** o erro é traduzido no formato da borda? Use o service **real**
com o repositório in-memory montado em `src/composition.ts`.

### REST — rota como função

As API Routes do App Router são funções `(Request) => Promise<Response>`. Teste-as
chamando `GET`/`POST` diretamente com um `Request` nativo — sem servidor de pé, sem
`fetch` para `localhost`. Cubra o feliz, o erro funcional (400 com `code`) e o gate do
feature flag (ligado/desligado).

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

describe('rota /api/resources (flag on)', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'development'
    process.env.RESOURCES_ENABLED = 'on'
    resourceRepository.clear()
  })
  afterEach(() => {
    delete process.env.APP_ENV
    delete process.env.RESOURCES_ENABLED
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

  it('GET lista o que foi criado', async () => {
    await POST(postReq({ title: 'Válido' }))
    const res = await GET(new Request('http://localhost/api/resources'))
    const page = await res.json() // { items, nextCursor } — mesma página do MCP
    expect(page.items.map((r: { title: string }) => r.title)).toEqual(['Válido'])
  })
})

describe('rota /api/resources (flag off)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'off'
    resourceRepository.clear()
  })

  it('POST → 404 quando desligado e NÃO persiste', async () => {
    const saveSpy = vi.spyOn(resourceRepository, 'save')
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(404)
    expect(saveSpy).not.toHaveBeenCalled()
    saveSpy.mockRestore()
  })
})
```

O login stub só existe com `APP_ENV=development`; sem ele a rota responde 401 — teste isso também.

Dois cuidados que este teste ilustra: **(1)** afirmar `code` no corpo (não só o status)
trava o contrato funcional/técnico; **(2)** com o flag off, verificar que a persistência
**não** foi tocada — o gate corta antes de qualquer efeito.

### MCP — `/api/mcp` com JSON-RPC

O endpoint MCP também é uma função `(Request) => Promise<Response>`: o teste manda
JSON-RPC (`tools/list`, `tools/call`) com um `Authorization: Bearer` e lê o resultado.
Use um **token pessoal semeado no próprio teste** — não dependa do Auth0 em teste
automatizado (o `Auth0JwtVerifier` tem teste próprio, com JWKS local).

```typescript
// tests/integration/mcp.route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST } from '@/app/api/mcp/route'
import { resourceRepository, personalTokens } from '@/composition'
import { rpc } from '../helpers/mcpRequest'

describe('/api/mcp', () => {
  let readToken: string

  beforeEach(async () => {
    process.env.APP_ENV = 'development'
    process.env.RESOURCES_ENABLED = 'on'
    process.env.MCP_RESOURCE_URL = 'http://localhost/api/mcp'
    resourceRepository.clear()
    personalTokens.clear()
    readToken = await personalTokens.issue({
      userId: 'ana',
      tenantId: 't1',
      scopes: ['resources:read'],
    })
  })
  afterEach(() => {
    for (const k of [
      'APP_ENV',
      'RESOURCES_ENABLED',
      'MCP_RESOURCE_URL',
      'MCP_RESOURCES_READ',
      'MCP_RESOURCES_WRITE',
    ])
      delete process.env[k]
  })

  it('sem token → 401 com WWW-Authenticate apontando o resource_metadata', async () => {
    const res = await POST(rpc('tools/list', {}))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=')
  })

  it('tools/list esconde create_resource com a flag de escrita desligada', async () => {
    const res = await POST(rpc('tools/list', {}, readToken))
    const names = (await res.json()).result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['list_resources'])
  })

  it('tools/call list_resources devolve só os recursos do actor do token', async () => {
    resourceRepository.seed([
      { ownerId: 'ana', tenantId: 't1', title: 'Da Ana' },
      { ownerId: 'bia', tenantId: 't1', title: 'Da Bia' },
    ])
    const res = await POST(rpc('tools/call', { name: 'list_resources', arguments: {} }, readToken))
    const { result } = await res.json()
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.items.map((r: { title: string }) => r.title)).toEqual([
      'Da Ana',
    ])
  })
})
```

O que este teste trava: autenticação é **HTTP 401** (não `isError`), a listagem respeita
**flag × escopo**, e o tenant/owner vem do **token**, nunca dos `arguments` da LLM. Erros
funcionais e técnicos dentro de uma tool voltam como `isError: true` — teste os dois
(mensagem acionável vs. genérica). Ver o [guia de MCP](./mcp-guide.md).

---

## Ao adotar um banco real (Neon/Drizzle)

O skeleton usa `InMemoryResourceRepository` — trocá-lo por um adapter real
(`NeonResourceRepository`, ADR-001/003) **não muda um único teste de service**: eles usam
o repositório in-memory pela interface. Só o teste do adapter concreto muda. Duas
armadilhas conhecidas ao testar com o driver HTTP do Neon:

1. **O driver embrulha o código de erro do Postgres.** Um `unique_violation` (`23505`)
   não aparece em `err.code`, e sim no encadeamento `err.cause`. Centralize a detecção
   num helper (`isUniqueViolation`) e, no teste, **mocke o formato aninhado** (o erro
   com a `cause`), não um `code` de topo.
2. **`server-only` quebra fora do Next.** Módulos marcados `import 'server-only'`
   lançam em Vitest; mocke-os (`vi.mock('server-only', () => ({}))`) no topo do teste,
   ou isole o adapter para não arrastar essa importação.

Mantenha, além disso, um **teste anti-drift de ambiente**: ele lê o `.env.local.example`
e falha se as variáveis divergirem do contrato esperado — barato e pega segredo
renomeado/esquecido antes de virar bug silencioso em produção.

---

## Mocking — Referência

```typescript
import { vi } from 'vitest'

const fn = vi.fn()
fn.mockReturnValue(42)
fn.mockResolvedValue({ ok: true })
fn.mockRejectedValue(new Error('falhou'))

expect(fn).toHaveBeenCalled()
expect(fn).toHaveBeenCalledWith('arg')
expect(fn).toHaveBeenCalledTimes(1)

// Spy num fake real (preferível a mockar o módulo inteiro)
const saveSpy = vi.spyOn(repo, 'save')

// Spy que restaura depois (evita vazar mock entre testes)
const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
// ...
spy.mockRestore()
```

Prefira **fakes in-memory** que implementam a interface (`InMemoryResourceRepository`) a
`vi.mock` de módulos: o fake exercita o contrato de verdade e sobrevive a refactors.

`any` é liberado em `tests/**` (a config ESLint desliga `no-explicit-any` ali) — é
idiomático em mocks. No app, continua proibido.

---

## Boas Práticas

- **Testes independentes** — nada de estado compartilhado entre `it`s; use
  `beforeEach` para reconstruir o mundo (novo repositório in-memory, ou `.clear()` nos
  singletons do `composition.ts`).
- **Actor explícito** — todo teste de service declara quem age e com quais escopos
  (`makeActor({ scopes: [...] })`).
- **Nomes descritivos** — "sem escopo de escrita → ForbiddenError", não "test1".
- **Um conceito por teste** — um `it`, uma afirmação de comportamento.
- **Restaure spies/timers** — `afterEach(() => vi.restoreAllMocks())`.
- **Teste o não-efeito** — quando uma regra deve impedir uma ação, afirme que o efeito
  **não** aconteceu (`save`/`fetch` não chamado), não só que houve erro.
- **Mesmo comportamento nas duas bordas** — o mesmo erro do service deve sair como
  `{ error, code }` no REST e como `isError: true` no MCP.

---

## Coverage

```bash
npm run test -- --coverage
```

Metas de referência: **≥ 70%** em lógica crítica (VOs, aggregates, services, guards,
verificadores de token, fronteira de erro) no início; **≥ 80%** global à medida que o
produto amadurece. Coverage é sinal, não meta cega — priorize os caminhos de decisão
(branches), não linhas triviais.

---

## E2E com Playwright (opcional)

Quando a UI estabilizar, adicione E2E para os fluxos ponta a ponta (login → ação →
verificação). Configure `webServer` apontando para `npm run dev`, rode headless no CI
com `retries` e `trace: 'on-first-retry'`. Mantenha poucos e focados nos caminhos de
maior valor — E2E é caro e frágil por natureza. A conexão real de um cliente MCP
(ChatGPT no UAT) é verificada manualmente — ver o [guia de MCP](./mcp-guide.md).

---

## Ver Também

- [ADR-011](../adr/011-service-layer-ddd-modular-e-perfis.md) — service como porta única (o que torna o teste barato)
- [ADR-012](../adr/012-mcp-como-borda-agentica.md) — borda MCP (o que os testes de `/api/mcp` afirmam)
- [ADR-009](../adr/009-erros-funcional-vs-tecnico.md) — taxonomia de erro (o que os testes de fronteira afirmam)
- [BEST_PRACTICES.md](../../BEST_PRACTICES.md) — padrões gerais
- [docs/guides/error-handling-guide.md](./error-handling-guide.md) — tratamento de erros
- [docs/guides/zod-guide.md](./zod-guide.md) — validação com Zod
