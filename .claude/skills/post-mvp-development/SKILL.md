---
name: post-mvp-development
description: Skill para desenvolvimento pós-MVP com Clean Architecture completa (SOLID, use-cases, repositories, services) e testes robustos. Use quando a complexidade justifica as camadas.
---

# Post-MVP Development

## Visão Geral

Guia o desenvolvimento **pós-MVP**, com a arquitetura completa: Clean
Architecture, SOLID, camadas bem definidas e testes robustos. Ver
`ARCHITECTURE.md` para o detalhamento das camadas.

## Quando Usar

- Features com regra de negócio rica ou que cruzam múltiplos domínios.
- Necessidade de isolar infraestrutura atrás de interfaces (trocar banco/auth
  sem tocar o domínio).
- Cobertura de testes robusta (unit + integration + E2E).

**NÃO use** para CRUD trivial de validação inicial → use `mvp-development`.

## Camadas (fluxo de uma feature)

```
presentation (hook → API Route) → application (use-case → guards) → domain (entities/interfaces)
                                                                   ↘ infrastructure (repositories)
```

1. **Domain** — entidade + interface do repositório (`I*Repository`) + types.
2. **Application** — use-case orquestra; chama **guards de autorização**
   (fail-closed) antes de tocar o repositório; DTOs validados com Zod.
3. **Infrastructure** — implementação concreta do repositório (banco de sua
   escolha) e do `IAuthProvider` (IdP de sua escolha). Mappers domínio ↔ banco.
4. **Presentation** — API Route valida payload, chama o use-case, traduz erros;
   hook consome a API e gerencia loading/error/data.

## Exemplo (use-case + injeção)

```typescript
// application/use-cases/resources/CreateResource.ts
export class CreateResourceUseCase {
  constructor(private repository: IResourceRepository) {}

  async execute(dto: CreateResourceDTO, ownerId: string): Promise<Resource> {
    const resource = new Resource(crypto.randomUUID(), dto.title, ownerId, false, new Date())
    await this.repository.save(resource)
    return resource
  }
}
```

```typescript
// presentation/app/api/resources/route.ts
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req)
    if (!user) return json({ error: 'Não autorizado' }, 401)
    const dto = createResourceSchema.parse(await req.json())
    const useCase = new CreateResourceUseCase(new ResourceRepository())
    return json(await useCase.execute(dto, user.id), 201)
  } catch (error) {
    return handleAPIError(error)
  }
}
```

## Server-state e UI-state (opcional)

Quando fizer sentido: **server-state** (ex.: React Query) para cache/refetch/
mutations, e **UI-state** (ex.: Zustand) para estado global de interface. Não
adote por padrão — adote quando o problema aparecer.

## Testes

- **Unit**: use-cases, services, entidades, utils (mocks dos repositórios).
- **Integration**: API Routes.
- **E2E**: fluxos completos (Playwright).
- Padrão AAA; nomes que descrevem comportamento (ver `testing-guide.md`).

## Checklist (Pós-MVP)

- [ ] Interface do repositório no domínio; implementação na infraestrutura
- [ ] Use-case chama guards de autorização (fail-closed)
- [ ] DTOs validados com Zod
- [ ] Erros mapeados (funcional vs técnico)
- [ ] Testes unit + integration (E2E se fluxo crítico)
- [ ] Decisões relevantes registradas em ADR
