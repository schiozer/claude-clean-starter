---
name: ddd-service-development
description: Skill para desenvolvimento com arquitetura completa — módulos por contexto, Service Layer como porta única, DDD tático (aggregates, value objects, repositórios) e bordas REST + MCP finas. Use em projetos com perfil `completo-direto` ou `mvp-primeiro` já promovido.
---

# DDD + Service Layer Development

## Visão Geral

Guia features na **arquitetura completa**: cada contexto de negócio é um módulo em
`src/modules/<ctx>/`, o `<Ctx>Service` é a porta única (casos de uso + guards), o domínio
usa DDD tático e as bordas (REST, MCP, Cron) são adaptadores finos. Ver
`ARCHITECTURE.md`, ADR-011 e ADR-012.

## Antes de Começar — Perfil

Leia `**Perfil arquitetural**` no `CLAUDE.md` do projeto:

- `completo-direto` → use esta skill.
- `mvp-primeiro` **promovido** (há ADR de promoção) → use esta skill.
- `mvp-primeiro` não promovido → pare e use `mvp-development`.
- Ausente ou inválido → **pergunte ao usuário** qual perfil adotar; não assuma.

## Fluxo de uma Feature

1. **Contexto**: a feature pertence a um módulo existente ou pede um novo? Nomeie na
   linguagem do negócio.
2. **Domínio** (`domain/`): Value Objects → Aggregate (invariantes, `create`/`rehydrate`,
   métodos de negócio) → `I<Agg>Repository`. Testes unitários puros.
3. **Aplicação** (`application/`): `schemas.ts` (Zod de input/output), `dto.ts` +
   `to<Agg>DTO`, método no `<Ctx>Service` com `actor` primeiro e guard na 1ª linha.
4. **Infraestrutura** (`infrastructure/`): repositório concreto + mapper linha ↔ aggregate.
5. **Bordas** (`interfaces/`):
   - `http/`: handler que resolve o `actor`, valida, chama o service, `handleAPIError`.
   - `mcp/tools.ts`: `defineTool` com `scope`, anotações e flag. **Pergunte ao usuário** se
     a capacidade deve ser exposta via MCP e com qual flag (ADR-006); escrita nasce
     **desligada por padrão**.
6. **Wiring**: registrar repo → service em `src/composition.ts`; exportar no `index.ts`.

## Exemplo

```typescript
// domain/Title.ts
export class Title {
  private constructor(readonly value: string) {}
  static of(raw: string): Title {
    const v = raw.trim()
    if (v.length < 3 || v.length > 100) throw new DomainError('Título deve ter de 3 a 100 caracteres', 'VALIDATION_ERROR')
    return new Title(v)
  }
}
```

```typescript
// application/ResourceService.ts
export class ResourceService {
  constructor(private repo: IResourceRepository, private clock: Clock) {}

  async create(actor: AuthUser, input: CreateResourceInput): Promise<ResourceDTO> {
    requireScope(actor, 'resources:write')
    const resource = Resource.create({ ownerId: actor.id, title: Title.of(input.title) }, this.clock)
    await this.repo.save(resource)
    return toResourceDTO(resource)
  }
}
```

```typescript
// interfaces/mcp/tools.ts
export const resourceTools = [
  defineTool({
    name: 'create_resource',
    description: 'Cria um recurso com o título informado.',
    input: createResourceSchema,
    scope: 'resources:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    flag: 'mcp.resources.write',
    handler: (actor, input) => services.resource.create(actor, input),
  }),
]
```

## Server-state e UI-state (opcional)

Server-state (ex.: React Query) e UI-state (ex.: Zustand) só quando o problema aparecer.

## Testes

- **Unit**: VOs e aggregates (invariantes); service com repositório fake (escopo ausente →
  erro; posse; DTO sem campos internos).
- **Integration**: handler REST e `tools/call` MCP chamando o service real com repo
  in-memory (ambos devem produzir o mesmo resultado e os mesmos erros).
- **E2E**: fluxos críticos (Playwright / Maestro no nativo).
- Padrão AAA; ver `docs/guides/testing-guide.md`.

## Checklist

- [ ] Perfil verificado no `CLAUDE.md`
- [ ] Código no módulo certo; fora dele só via `index.ts`
- [ ] VO/aggregate protegem invariantes; sem setters públicos
- [ ] Service: `actor` primeiro, guard antes de dados, DTO na saída
- [ ] Bordas finas (REST e MCP) sem regra/autorização
- [ ] Tool MCP: `scope`, anotações, flag (escrita desligada por padrão), descrição "quando usar"
- [ ] Erros funcional vs técnico (ADR-009)
- [ ] Testes unit + integration (REST e MCP)
- [ ] Decisões relevantes em ADR
