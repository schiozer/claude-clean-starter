# Guia de Testes

**Última Atualização**: 2026-09-06
**Versão**: 2.0.0

---

## Visão Geral

Este guia é **auto-contido**: todo padrão citado tem um teste equivalente em
`examples/walking-skeleton/tests/`. As ferramentas do starter:

- **Vitest** — testes unitários e de integração.
- **happy-dom** — DOM leve para componentes/hooks (mais rápido que jsdom).
- **Testing Library** — testes de componentes React (quando houver UI a testar).
- **Playwright** — E2E, opcional/pós-MVP.

A arquitetura em camadas (domain → application → infrastructure → presentation,
ADR-001) é o que torna o teste barato: a lógica não depende de framework nem de
banco, então a maior parte é teste unitário de função pura + use-case com repositório
mockado pela **interface**.

---

## Pirâmide de Testes

```
        /\
       /E2E\      ← poucos, lentos, alta confiança (Playwright, opcional)
      /------\
     / Integ. \   ← rotas de API (Request → Response), médio volume
    /----------\
   / Unit Tests \ ← muitos, rápidos: entidades, use-cases, validators, utils
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
> limpe no `afterEach` — ver o teste de rota abaixo. Isso mantém os testes isolados e
> evita drift com o contrato real de env.

---

## Testes Unitários

**TESTE:** lógica de negócio (entidades, use-cases), funções puras, validações Zod,
edge cases (`null`/`undefined`/vazio), guards.

**NÃO TESTE (ainda):** componentes puramente visuais, getters/setters triviais, e o
SDK do banco em si (mocke a **interface** do repositório, não o driver).

### Padrão AAA (Arrange, Act, Assert)

```typescript
// tests/unit/Resource.test.ts (padrão)
import { describe, it, expect } from 'vitest'
import { Resource } from '@/domain/entities/Resource'

describe('Resource', () => {
  it('rejeita título com menos de 3 caracteres', () => {
    // Arrange + Act + Assert
    expect(() => Resource.create({ title: 'ab' }, 'owner-1')).toThrow()
  })
})
```

### Validações Zod

```typescript
// tests/unit/resourceSchemas.test.ts (padrão)
import { describe, it, expect } from 'vitest'
import { createResourceSchema } from '@/application/validators/resourceSchemas'

describe('createResourceSchema', () => {
  it('aceita título válido', () => {
    expect(() => createResourceSchema.parse({ title: 'Válido' })).not.toThrow()
  })

  it('rejeita título curto', () => {
    expect(() => createResourceSchema.parse({ title: 'ab' })).toThrow()
  })
})
```

### Use-cases: mocke o repositório pela **interface**

Este é o padrão central do starter. O use-case recebe um `IResourceRepository` por
injeção; no teste, você fornece um mock que implementa a interface — nenhum banco
envolvido. Assim o teste é rápido, determinístico e independe da infraestrutura.

```typescript
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
    const result = await new CreateResourceUseCase(repo).execute({ title: 'Novo' }, 'owner-1')
    expect(result.ownerId).toBe('owner-1')
    expect(repo.save).toHaveBeenCalledTimes(1)
  })

  it('propaga erro de domínio para título inválido — e NÃO salva', async () => {
    const repo = mockRepo()
    await expect(new CreateResourceUseCase(repo).execute({ title: 'ab' }, 'owner-1')).rejects.toThrow()
    expect(repo.save).not.toHaveBeenCalled()
  })
})
```

Repare no segundo teste: além do `throw`, ele afirma `save` **não** foi chamado — a
regra falha **antes** de tocar a persistência. Testar o "não-efeito" é tão importante
quanto testar o efeito.

### Guards (autorização fail-closed)

```typescript
// tests/unit/resourceGuards.test.ts (padrão)
import { describe, it, expect } from 'vitest'
import { requireUser } from '@/application/authz/resourceGuards'
import { UnauthorizedError } from '@/shared/errors'

describe('requireUser', () => {
  it('lança UnauthorizedError quando não há usuário', () => {
    expect(() => requireUser(null)).toThrow(UnauthorizedError)
  })
})
```

---

## Testes de Integração — Rotas de API

As API Routes do App Router são funções `(Request) => Promise<Response>`. Teste-as
chamando `GET`/`POST` diretamente com um `Request` nativo — sem servidor de pé, sem
`fetch` para `localhost`. Cubra o feliz, o erro funcional (400 com `code`) e o gate
do feature flag (dois estados: ligado/desligado).

```typescript
// tests/integration/resources.route.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GET, POST } from '@/app/api/resources/route'
import { resourceRepository } from '@/infrastructure/composition'

const postReq = (body: unknown) =>
  new Request('http://localhost/api/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const getReq = () => new Request('http://localhost/api/resources')

describe('rota /api/resources (flag on)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'on'
    resourceRepository.clear()
  })
  afterEach(() => {
    delete process.env.RESOURCES_ENABLED
  })

  it('POST com título válido → 201', async () => {
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(201)
    expect((await res.json()).ownerId).toBe('dev-user')
  })

  it('POST com título inválido → 400 VALIDATION_ERROR', async () => {
    const res = await POST(postReq({ title: 'ab' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('VALIDATION_ERROR')
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

Dois cuidados que este teste ilustra: **(1)** afirmar `code` no corpo (não só o
status) trava o contrato funcional/técnico; **(2)** com o flag off, verificar que a
persistência **não** foi tocada — o gate corta antes de qualquer efeito.

---

## Ao adotar um banco real (Neon/Drizzle)

O skeleton usa `InMemoryResourceRepository` — trocá-lo por um adapter real
(`NeonResourceRepository`, ADR-001/003) **não muda um único teste de use-case**: eles
mockam a interface. Só o teste do adapter concreto muda. Duas armadilhas conhecidas ao
testar com o driver HTTP do Neon:

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

// Mock de módulo
vi.mock('@/infrastructure/composition', () => ({ resourceRepository: mockRepo() }))

// Spy que restaura depois (evita vazar mock entre testes)
const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
// ...
spy.mockRestore()
```

`any` é liberado em `tests/**` (a config ESLint desliga `no-explicit-any` ali) — é
idiomático em mocks. No app, continua proibido.

---

## Boas Práticas

- **Testes independentes** — nada de estado compartilhado entre `it`s; use
  `beforeEach` para reconstruir o mundo (e `resourceRepository.clear()` quando usar o
  repositório em memória).
- **Nomes descritivos** — "rejeita título curto", não "test1".
- **Um conceito por teste** — um `it`, uma afirmação de comportamento.
- **Restaure spies/timers** — `afterEach(() => vi.restoreAllMocks())`.
- **Teste o não-efeito** — quando uma regra deve impedir uma ação, afirme que o efeito
  **não** aconteceu (`save`/`fetch` não chamado), não só que houve erro.

---

## Coverage

```bash
npm run test -- --coverage
```

Metas de referência: **≥ 70%** em lógica crítica (entidades, use-cases, guards,
fronteira de erro) no início; **≥ 80%** global à medida que o produto amadurece.
Coverage é sinal, não meta cega — priorize os caminhos de decisão (branches), não
linhas triviais.

---

## E2E com Playwright (opcional / pós-MVP)

Quando a UI estabilizar, adicione E2E para os fluxos ponta a ponta (login → ação →
verificação). Configure `webServer` apontando para `npm run dev`, rode headless no CI
com `retries` e `trace: 'on-first-retry'`. Mantenha poucos e focados nos caminhos de
maior valor — E2E é caro e frágil por natureza.

---

## Ver Também

- [ADR-001](../adr/001-neon-auth0.md) — arquitetura que torna o teste barato (camadas + interfaces)
- [ADR-009](../adr/009-erros-funcional-vs-tecnico.md) — taxonomia de erro (o que os testes de fronteira afirmam)
- [BEST_PRACTICES.md](../../BEST_PRACTICES.md) — padrões gerais
- [docs/guides/error-handling-guide.md](./error-handling-guide.md) — tratamento de erros
- [docs/guides/zod-guide.md](./zod-guide.md) — validação com Zod
</content>
