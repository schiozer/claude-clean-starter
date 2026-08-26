# Arquitetura

**Versão do template**: 1.0.0

> Documento de **direção arquitetural** do template. Os exemplos usam um domínio
> fictício e um framework (React/Next.js) apenas como ilustração — a stack
> concreta do seu projeto (banco, auth, hospedagem) deve ser registrada em ADRs.

---

## Visão Geral

O projeto segue princípios de **Clean Architecture** e **SOLID**, com separação
clara de responsabilidades entre camadas. A arquitetura busca ser:

- **Testável**: lógica de negócio isolada do framework
- **Manutenível**: mudanças em uma camada não afetam outras
- **Escalável**: fácil adicionar novos casos de uso
- **Evolutiva**: preparada para trocar infraestrutura (banco, auth, app nativo)

O projeto pode começar **simples (MVP)** e evoluir para a **arquitetura completa
(Pós-MVP)** conforme a complexidade cresce. Ver `CLAUDE.md` e as skills.

---

## Princípios Arquiteturais

### 1. SOLID

- **SRP** — cada classe/função tem uma única razão para mudar.
- **OCP** — aberto para extensão, fechado para modificação (interfaces, strategies).
- **LSP** — implementações substituem interfaces sem quebrar contratos
  (repositórios intercambiáveis: trocar o banco não muda o domínio).
- **ISP** — interfaces específicas, não genéricas.
- **DIP** — dependa de abstrações, não de implementações (injeção de dependência).

### 2. Clean Architecture

```
┌─────────────────────────────────────────┐
│         UI Layer (Presentation)         │
│  Components, Pages, API Routes (BFF)    │
├─────────────────────────────────────────┤
│       Application Layer (Use Cases)     │
│  Orquestração, regra de negócio         │
├─────────────────────────────────────────┤
│          Domain Layer                   │
│  Entities, Interfaces, Types            │
├─────────────────────────────────────────┤
│        Infrastructure Layer             │
│  Repositories, serviços externos        │
└─────────────────────────────────────────┘
```

**Regra de Dependência**: camadas externas dependem de internas, nunca o contrário.

---

## Estrutura de Diretórios (Pós-MVP)

```
src/
├── domain/                 # Núcleo — sem dependências externas
│   ├── entities/           # Entidades de negócio (regras + validações básicas)
│   ├── interfaces/         # Contratos (I*Repository, I*Service, IAuthProvider)
│   └── types/              # Types/enums compartilhados
│
├── application/            # Casos de uso
│   ├── use-cases/          # Um caso de uso por ação do usuário
│   ├── services/           # Lógica que cruza múltiplas entidades
│   ├── authz/              # Guards de autorização (fail-closed)
│   └── validators/         # Schemas Zod (reusados no front e no back)
│
├── infrastructure/         # Implementações concretas das interfaces
│   ├── repositories/       # Implementam I*Repository (banco de sua escolha)
│   ├── auth/               # Implementa IAuthProvider (IdP de sua escolha)
│   └── external/           # APIs externas
│
├── presentation/           # UI
│   ├── app/                # Rotas/páginas
│   ├── components/         # Componentes (ui/, shared/, por feature)
│   └── hooks/              # Custom hooks (encapsulam side effects)
│
└── shared/                 # Erros, utils, constants
```

> No **MVP**, `domain/application/infrastructure` podem não existir ainda: hooks
> falam direto com o acesso a dados e a validação vive na borda. Introduza as
> camadas quando a complexidade justificar.

---

## Camadas Detalhadas

### 1. Domain Layer (Núcleo)

Regras de negócio puras, sem dependências externas.

```typescript
// src/domain/entities/Resource.ts
export class Resource {
  constructor(
    public readonly id: string,
    public title: string,
    public ownerId: string,
    public published: boolean,
    public createdAt: Date
  ) {
    this.validate()
  }

  private validate(): void {
    if (!this.title || this.title.length < 3) {
      throw new DomainError('Título deve ter pelo menos 3 caracteres')
    }
  }
}
```

```typescript
// src/domain/interfaces/repositories/IResourceRepository.ts
export interface IResourceRepository {
  findById(id: string): Promise<Resource | null>
  findByOwnerId(ownerId: string): Promise<Resource[]>
  save(resource: Resource): Promise<void>
  delete(id: string): Promise<void>
}
```

### 2. Application Layer (Casos de Uso)

Orquestra regra de negócio; **chama os guards de autorização antes** de acessar
repositórios (fail-closed).

```typescript
// src/application/use-cases/resources/CreateResource.ts
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
// src/application/validators/resourceSchemas.ts
import { z } from 'zod'

export const createResourceSchema = z.object({
  title: z.string().min(3).max(100),
})
export type CreateResourceDTO = z.infer<typeof createResourceSchema>
```

### 3. Infrastructure Layer (Acesso a Dados)

Implementa as interfaces do domínio. Converte entre entidades de domínio e o
formato do banco. Trocar de banco = nova implementação da **mesma** interface.

```typescript
// src/infrastructure/repositories/ResourceRepository.ts
export class ResourceRepository implements IResourceRepository {
  async findById(id: string): Promise<Resource | null> {
    // ... query ao seu banco; mapeie a linha para a entidade de domínio
  }
  // ... save/delete/findByOwnerId
}
```

**Auth** vive atrás de `IAuthProvider`, isolando o IdP escolhido do resto do app.

### 4. Presentation Layer (UI)

Interface com o usuário, sem lógica de negócio.

- **API Routes (BFF)**: validam payload com Zod, chamam use-cases, traduzem
  erros técnicos em user-friendly.
- **Components**: delegam lógica para hooks.
- **Hooks**: encapsulam chamadas à API e gerenciam loading/error/data.

```typescript
// src/presentation/app/api/resources/route.ts (exemplo)
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req)
    if (!user) return json({ error: 'Não autorizado' }, 401)

    const dto = createResourceSchema.parse(await req.json())
    const useCase = new CreateResourceUseCase(new ResourceRepository())
    const resource = await useCase.execute(dto, user.id)
    return json(resource, 201)
  } catch (error) {
    return handleAPIError(error)
  }
}
```

---

## Autorização

Escolha um mecanismo e aplique-o de forma **fail-closed** (esqueceu de autorizar
→ sem acesso):

- **No banco** (ex.: Row Level Security), ou
- **Em uma camada de serviço com guards** (`src/application/authz/`), chamados
  por todos os use-cases antes de tocar repositórios.

Documente a escolha em um ADR. Nunca dependa apenas de checagens no cliente.

---

## Backend / Serverless

Lógica de backend (webhooks, jobs, integrações) pode viver em API Routes,
funções serverless ou um serviço dedicado. Mantenha-a fina: valide entrada
(Zod), chame use-cases, trate erros. A escolha da plataforma é um ADR.

---

## Padrões e Convenções

- **Dependency Injection** via construtor.
- **DTOs** para cruzar fronteiras de camadas (input e output).
- **Mappers** para converter entre formatos (domínio ↔ banco ↔ resposta).

---

## Considerações de Evolução

- **App nativo**: hooks e domínio são reutilizáveis; `domain/` e `application/`
  copiam para o mobile.
- **Troca de backend**: novos repositories implementando as mesmas interfaces;
  use-cases permanecem intocados.

---

## Ver Também

- [BEST_PRACTICES.md](./BEST_PRACTICES.md)
- [docs/guides/](./docs/guides/)
- [docs/adr/](./docs/adr/)
