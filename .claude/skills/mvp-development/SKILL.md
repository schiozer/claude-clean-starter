---
name: mvp-development
description: Skill para a fase MVP de projetos com perfil `mvp-primeiro` — módulos com Service enxuto (sem aggregates/repositórios), bordas REST + MCP finas desde o dia 1. Não use em projetos `completo-direto`.
---

# MVP Development

## Visão Geral

Guia features na **fase MVP**: validar o produto rápido com o mínimo de cerimônia, **sem
abrir mão** da porta única (Service), da autorização no servidor e da borda MCP. A
estrutura de pastas é a mesma do perfil completo (`src/modules/<ctx>/`) — só faltam
`domain/` e `infrastructure/`. Assim a promoção não move as bordas.

## Antes de Começar — Perfil

Leia `**Perfil arquitetural**` no `CLAUDE.md` do projeto:

- `mvp-primeiro` (não promovido) → use esta skill.
- `completo-direto` → **não use**; este projeto não tem fase MVP. Use `ddd-service-development`.
- Ausente ou inválido → **pergunte ao usuário** qual perfil adotar; não assuma.

## Decisões Arquiteturais (MVP)

- ✅ `src/modules/<ctx>/application/<Ctx>Service.ts` com **`actor` primeiro** e guard
  (`requireScope`) antes de qualquer acesso a dados; acesso ao banco **direto** no service.
- ✅ `schemas.ts` (Zod) e `dto.ts` — os mesmos usados por REST, MCP e UI.
- ✅ `interfaces/http/` e `interfaces/mcp/tools.ts` finos; escrita MCP **desligada por padrão**.
- ✅ Hooks (`useState` + `useEffect`) chamando a API REST; Context só para sessão/auth.
- ❌ SEM aggregates, value objects, repositórios ou `I*Repository`.
- ❌ SEM server-state (React Query) até doer.

## Exemplo (service enxuto)

```typescript
// src/modules/resources/application/ResourceService.ts
export class ResourceService {
  constructor(private db: Db) {}

  async list(actor: AuthUser, input: ListResourcesInput): Promise<ResourceDTO[]> {
    requireScope(actor, 'resources:read')
    const rows = await this.db.query(
      'select id, title, published, created_at from resources where tenant_id = $1 and owner_id = $2 order by created_at desc limit $3',
      [actor.tenantId, actor.id, input.limit]
    )
    return rows.map(toResourceDTO)
  }
}
```

```typescript
// src/modules/resources/interfaces/mcp/tools.ts
export const makeResourceTools = (service: ResourceService) => [
  defineTool({
    name: 'list_resources',
    description: 'Lista os recursos do usuário. Use para responder "quais são meus recursos".',
    input: listResourcesSchema,
    scope: 'resources:read',
    annotations: { readOnlyHint: true },
    flag: 'mcp.resources.read',
    handler: (actor, input) => service.list(actor, input),
  }),
]
```

```typescript
// src/ui/hooks/useResources.ts
export function useResources() {
  const [resources, setResources] = useState<ResourceDTO[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetchResources()
  }, [])

  async function fetchResources() {
    try {
      const res = await fetch('/api/resources')
      if (!res.ok) throw new Error('fetch failed')
      setResources(await res.json())
    } catch {
      notify.error('Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }

  return { resources, loading, fetchResources }
}
```

## Cenários da spec → Playwright

A seção "8. Cenários de teste" da spec (revisada pela QA) é o contrato dos testes E2E e
sistêmicos ([ADR-016](../../../docs/adr/template/016-testes-e2e-nascidos-da-spec.md),
`docs/guides/e2e-guide.md`):

1. **Antes da tela/rota**, escrever o teste Playwright de cada cenário: título começando pelo ID
   (`CT-<CTX>-NNN`), tags = tipo + destinos (com `@regressao`), passos via `jornada()` com as chaves
   iguais ao texto da spec. Rodar e ver falhar (TDD).
2. Implementar até `npm run test:e2e -- --grep CT-<CTX>-NNN` passar nos projetos `desktop`/`mobile`
   (ou `sistemico`).
3. Página nova entra em "Telas" (ou "Exclusões") do `docs/rnf.md`; desvio de RNF tem teste com o
   mesmo ID.
4. `npm run check:cenarios -- --spec <spec>` sem erro (todo `@regressao` com teste, passos
   iguais, `@doc` com página).
5. **`npm run docs:gerar` antes do PR** (se houver `@doc`), contra o app local, e commitar a
   ajuda gerada na feature branch.

## Checklist (MVP)

- [ ] Perfil verificado no `CLAUDE.md`
- [ ] Service: `actor` primeiro, guard antes de dados, DTO na saída
- [ ] Validação Zod na borda (mesmo schema em REST e MCP)
- [ ] Tool MCP perguntada ao usuário (expor? flag?); escrita desligada por padrão
- [ ] Erros funcional vs técnico (ver BEST_PRACTICES)
- [ ] Loading/erro na UI; TypeScript sem `any`
- [ ] Testes do service (escopo, isolamento por owner) e dos hooks críticos
- [ ] Teste Playwright de cada cenário da spec escrito antes da tela/rota; `npm run check:cenarios` ok
- [ ] `npm run docs:gerar` rodado antes do PR e a ajuda commitada (se houver `@doc`)

## Promoção para o Completo

Quando surgir regra que cruza entidades, invariantes ricas ou necessidade de trocar
infraestrutura, **proponha** a promoção ao usuário (nunca promova sozinho). Se aceita:

1. Registrar ADR do projeto ("promoção do projeto ao perfil completo"). A promoção é
   **por projeto**, não por módulo.
2. Trocar o campo no `CLAUDE.md` para exatamente
   `**Perfil arquitetural**: mvp-primeiro (promovido — ADR-NNN)`.
3. Migrar módulo a módulo (já sob `ddd-service-development`): extrair VOs/aggregate para `domain/`, criar `I<Agg>Repository` e o
   repositório em `infrastructure/`, injetar no service. **Não** alterar `interfaces/` nem
   a assinatura pública do service — os testes de REST/MCP devem passar sem mudança.
4. Seguir daí com `ddd-service-development`.
