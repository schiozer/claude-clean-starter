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

Todo projeto declara um **perfil arquitetural** no `CLAUDE.md` — `mvp-primeiro`
(começa enxuto e é promovido) ou `completo-direto` (sem fase MVP) — ver
[ADR-011](./docs/adr/011-service-layer-ddd-modular-e-perfis.md). Em ambos, o sistema é
**agêntico**: além da UI/REST, expõe um servidor **MCP** que LLMs chamam em nome do
usuário ([ADR-012](./docs/adr/012-mcp-como-borda-agentica.md)).

> ⚠️ O exemplo em `examples/walking-skeleton/` ainda usa o layout por camada técnica;
> a migração para `modules/` + MCP é a entrega 2 da spec
> `docs/superpowers/specs/2026-10-10-arquitetura-agentica-mcp-design.md`.

---

## Princípios Arquiteturais

### 1. SOLID

- **SRP** — cada classe/função tem uma única razão para mudar.
- **OCP** — aberto para extensão, fechado para modificação (interfaces, strategies).
- **LSP** — implementações substituem interfaces sem quebrar contratos
  (repositórios intercambiáveis: trocar o banco não muda o domínio).
- **ISP** — interfaces específicas, não genéricas.
- **DIP** — dependa de abstrações, não de implementações (injeção de dependência).

### 2. Clean Architecture com Service Layer como porta única

```
 ChatGPT / Claude ──MCP──┐
 Web / Mobile ────REST───┼──►  <Ctx>Service  (casos de uso + guards, DTOs Zod)
 Cron / Webhooks ────────┘            │
                                      ▼
                         Domínio (Aggregates, Value Objects)
                                      │
                                      ▼
                     Repositórios (I*Repository → banco)
```

**Regra de Dependência**: bordas (`interfaces/`) dependem da aplicação; aplicação depende
do domínio; infraestrutura implementa interfaces do domínio. Nunca o contrário.

**Regra da porta única**: toda borda chama o **service**. Nenhuma borda acessa
repositório, e nenhuma contém regra de negócio ou autorização.

---

## Estrutura de Diretórios (por módulo de contexto)

```
src/
├── modules/
│   └── <contexto>/                    # bounded context (ex.: resources)
│       ├── domain/                    # só no completo: Aggregates, VOs, I*Repository, erros de domínio
│       ├── application/
│       │   ├── <Ctx>Service.ts        # API pública do módulo: casos de uso + guards
│       │   ├── schemas.ts             # Zod de input/output (REST, MCP e UI)
│       │   └── dto.ts
│       ├── infrastructure/            # só no completo: repositórios concretos
│       ├── interfaces/
│       │   ├── http/                  # handlers REST finos
│       │   └── mcp/tools.ts           # tools MCP finas
│       └── index.ts                   # exporta SÓ service, schemas, DTOs e as factories das bordas
├── shared/
│   ├── kernel/                        # Entity, ValueObject, AggregateRoot (só no completo)
│   ├── auth/                          # AuthUser, IAccessTokenVerifier, guards genéricos
│   ├── mcp/                           # defineTool, registry, servidor
│   ├── errors.ts                      # AppError & subclasses (ADR-009)
│   ├── handleApiError.ts              # fronteira erro → resposta (ADR-009)
│   └── logError.ts                    # sink central de log (ADR-009)
├── ui/                                # components/ e hooks/ (chamam a API REST)
├── composition.ts                     # wiring: deps → services → bordas (DI por construtor)
└── app/                               # Next.js: app/api/<ctx>/route.ts e app/api/mcp/route.ts só delegam
```

### Regras de fronteira

1. Fora do módulo, importa-se **só** `modules/<ctx>/index.ts` (ESLint `no-restricted-imports`).
   O `index.ts` exporta o service, schemas, DTOs e as **factories das bordas**
   (`make<Ctx>Tools(service)`, `make<Ctx>Handlers(service)`). **Única exceção:**
   `src/composition.ts`, que importa `infrastructure/` para instanciar repositórios, monta os
   services e as bordas. `app/` importa só de `composition.ts`. Bordas recebem o service por
   parâmetro (nunca importam `composition.ts`), o que evita dependência circular.
2. Um contexto fala com outro **pelo service** do outro, nunca pelo repositório.
3. `interfaces/*` não contém regra de negócio nem autorização: valida, chama o service, traduz.
4. No perfil MVP, `domain/` e `infrastructure/` não existem; o service acessa dados direto.
   Promoção = **extrair para dentro** do módulo, sem alterar `interfaces/`.

---

## Service Layer

O `<Ctx>Service` é a **API pública** do módulo.

```typescript
// src/modules/resources/application/ResourceService.ts
export class ResourceService {
  constructor(private repo: IResourceRepository, private clock: Clock) {}

  async list(actor: AuthUser, input: ListResourcesInput): Promise<ResourceDTO[]> {
    requireScope(actor, 'resources:read')
    const items = await this.repo.findByOwner(actor.tenantId, actor.id, input)
    return items.map(toResourceDTO)
  }

  async create(actor: AuthUser, input: CreateResourceInput): Promise<ResourceDTO> {
    requireScope(actor, 'resources:write')
    const resource = Resource.create({ ownerId: actor.id, title: Title.of(input.title) }, this.clock)
    await this.repo.save(resource)
    return toResourceDTO(resource)
  }
}
```

- Todo método público recebe **`actor: AuthUser` como 1º parâmetro** e chama um guard antes
  de qualquer acesso a dados. Cron usa um **ator de sistema** explícito com escopos próprios.
- `AuthUser = { id, tenantId, scopes: string[], via: 'session' | 'oauth' | 'pat' | 'system' }`.
- Escopos `<ctx>:read` / `<ctx>:write`; a sessão web recebe os escopos do papel do usuário.
- Entrada e saída por **DTO validado (Zod)**; o service **nunca devolve entidade**.
- Regras dependentes do objeto (posse — `assertOwnership`) ficam no service.

## DDD tático (perfil completo)

```typescript
// src/modules/resources/domain/Resource.ts
export class Resource extends AggregateRoot {
  private constructor(
    readonly id: ResourceId,
    readonly ownerId: string,
    private _title: Title,
    private _published: boolean,
    readonly createdAt: Date
  ) { super() }

  static create(props: { ownerId: string; title: Title }, clock: Clock): Resource {
    return new Resource(ResourceId.new(), props.ownerId, props.title, false, clock.now())
  }

  static rehydrate(row: ResourceRow): Resource { /* banco → domínio */ }

  publish(): void {
    if (this._published) throw new DomainError('Recurso já publicado')
    this._published = true
  }
}
```

- **Aggregate Root**: `create()`/`rehydrate()`, sem setters públicos, métodos com nome de
  negócio, protege invariantes.
- **Value Objects** (`Title`, `ResourceId`): validam na construção, imutáveis.
- **Repositório por aggregate**: interface em `domain/`, implementação em `infrastructure/`.
- **Domain events (opcional)**: o aggregate registra, o service publica após o `save`.
  Adote só com consumidor real.
- **Ubiquitous language** em métodos e nomes de tools MCP.

> No **perfil MVP** o service tem a **mesma assinatura pública**, mas acessa o banco direto,
> sem aggregate nem repositório.

## Bordas (interfaces/)

**REST (BFF)** — `modules/<ctx>/interfaces/http/`, montado em `app/api/<ctx>/route.ts`:

```typescript
// src/modules/resources/interfaces/http/handlers.ts
export const makeResourceHandlers = (service: ResourceService) => ({
  async POST(req: Request) {
    try {
      const actor = await resolveActor(req)               // sessão → AuthUser (ou 401)
      const input = createResourceSchema.parse(await req.json())
      return json(await service.create(actor, input), 201)
    } catch (error) {
      return handleApiError(error, 'api/resources:POST')
    }
  },
})

// src/app/api/resources/route.ts — só delega
export const { POST } = resourceHandlers                // montado em src/composition.ts
```

**MCP** — ver a seção "Borda agêntica (MCP)" abaixo.

**UI** — componentes delegam a hooks; hooks chamam a API REST e gerenciam loading/error/data.

---

## Borda agêntica (MCP)

Detalhes e justificativas em [ADR-012](./docs/adr/012-mcp-como-borda-agentica.md); passo a
passo de conexão em [docs/guides/mcp-guide.md](./docs/guides/mcp-guide.md).

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
  defineTool({
    name: 'create_resource',
    description: 'Cria um recurso com o título informado.',
    input: createResourceSchema,
    scope: 'resources:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    flag: 'mcp.resources.write', // escrita: desligada por padrão
    handler: (actor, input) => service.create(actor, input),
  }),
]
```

```
ChatGPT ──POST /api/mcp (Bearer)──► IAccessTokenVerifier ──► AuthUser
                                     (Auth0JwtVerifier | PersonalTokenVerifier)
        ◄── 401 + WWW-Authenticate (sem token) ── /.well-known/oauth-protected-resource → Auth0 do ambiente
registry: tools com flag ligada E escopo no token ──► handler ──► <Ctx>Service (revalida escopo)
```

- Servidor único `app/api/mcp/route.ts`: SDK oficial, **Streamable HTTP stateless**.
- `Auth0JwtVerifier` valida JWKS, `iss`, **`aud` contém a URL do MCP do ambiente** (o `aud` pode vir em array), `exp`, escopos.
- `PersonalTokenVerifier`: tokens `pat_…` guardados só como hash SHA-256, com escopos,
  expiração e revogação.
- Erros: autenticação → HTTP 401; demais → `isError: true` (funcional = acionável,
  técnico = genérico).
- Rate limit por ator (ADR-010) e auditoria das tools de escrita.

---

## Autorização

Aplique a autorização de forma **fail-closed** (esqueceu de autorizar → sem
acesso). A ordem de preferência é:

- **Padrão — guards no Application Service** (`requireScope`, `assertOwnership`),
  chamados por **todo** método público do `<Ctx>Service` antes de tocar dados. A
  identidade chega como `AuthUser` (sessão web, OAuth/JWT do IdP ou token pessoal),
  com **escopos** `<ctx>:read|write`; a regra de acesso vive no código, testável e
  versionada. Como REST, MCP e Cron passam pelo mesmo service, nenhuma borda pula a
  autorização. Combina com um Postgres "puro" (ex.: Neon) atrás de `I*Repository` e um
  IdP externo (ex.: Auth0) atrás de `IAuthProvider` + `IAccessTokenVerifier`.
- **Dois papéis de auth, um só `AuthUser`**: `IAuthProvider` cuida do **login/sessão web**
  (Universal Login, cookie); `IAccessTokenVerifier` valida **bearer tokens** (JWT OAuth ou
  PAT) no MCP e na API para clientes nativos. Ambos produzem `AuthUser`; os services só
  conhecem `AuthUser`.
- **Reforço opcional — no banco** (ex.: Row Level Security). Útil como segunda
  linha de defesa, mas depende de integração nativa DB↔IdP (padrão em BaaS como o
  Supabase); em Postgres genérico exige propagar a identidade manualmente. Não a
  use como **única** camada quando a regra é rica — ela é difícil de testar.

Documente a escolha concreta em um ADR (ver `docs/adr/`). Nunca dependa apenas de
checagens no cliente.

---

## Backend / Serverless

Lógica de backend (webhooks, jobs, integrações) pode viver em API Routes,
funções serverless ou um serviço dedicado. Mantenha-a fina: valide entrada
(Zod), chame o service do módulo, trate erros. A escolha da plataforma é um ADR.

---

## Padrões para App Nativo (iOS / React Native + Expo)

> Esta seção **complementa** (não substitui) os padrões web acima. Os exemplos web
> assumem um monólito onde UI e backend convivem (ex.: Next.js). Num **app nativo**
> o dispositivo é apenas um **cliente**: o backend vira um deployable separado.

### O que muda em relação à web

Na web (ex.: Next.js), presentation e backend (API routes, services, repositories)
podem morar no mesmo processo. No nativo isso **se divide em dois deployables**:

- **App (dispositivo)** — presentation + application-cliente (hooks, api-client) +
  domínio/validadores **compartilhados** (types + Zod). **Nunca** acessa o banco
  direto e **nunca** guarda segredos.
- **Backend (servidor)** — services, repositórios, guards de autorização e acesso
  ao banco. Único lugar com segredos e credenciais.

### Regra de ouro do nativo

O bundle do app é **público** (qualquer um extrai). Portanto:

- Zero segredos/API keys no app; só no backend (`process.env`).
- Toda autorização é **no servidor** (fail-closed); o cliente só melhora UX.
- Tokens de sessão em **armazenamento seguro** (Keychain via `expo-secure-store`),
  nunca em `AsyncStorage`.

### Estrutura recomendada (monorepo)

```
.
├── apps/
│   ├── mobile/            # Expo (React Native) — iOS
│   │   ├── app/           # rotas (expo-router)
│   │   ├── components/    # ui/, shared/, por feature
│   │   ├── hooks/         # encapsulam api-client + estado (loading/error/data)
│   │   └── lib/           # api-client, secure storage, push
│   └── api/               # backend (serverless / Node) — src/modules/<ctx>/ (services, repos, http, mcp)
├── packages/
│   └── shared/            # schemas Zod + DTOs dos módulos — reusado por mobile e api
```

> O `packages/shared` é o coração reaproveitável: schemas Zod e DTOs dos módulos
> ficam ali e são importados tanto pela UI (validação na borda) quanto pelo backend
> (validação nos services). Aggregates e services **não** vão para o app — ficam no
> backend, atrás das bordas REST/MCP (ver *Considerações de Evolução*).

### Fluxo de dados

```
Tela (RN) → hook → api-client (fetch + JWT)
      → função serverless: valida Zod → <Ctx>Service (guard → regra) → repository → DB
      → resposta (DTO) → hook → tela
```

### Diagrama de camadas (nativo)

```
┌───────────────────── Dispositivo (cliente) ─────────────────────┐
│  Presentation: screens, components, navegação (expo-router)      │
│  Application-cliente: hooks, api-client, cache de server-state   │
│  Shared: domain types + validators (Zod)  ← também no servidor   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS + JWT
┌──────────────────────────────▼──────────────────────────────────┐
│  Backend (deployable separado)                                   │
│  Presentation-BFF: valida payload (Zod), traduz erros            │
│  Application: services + authz guards (fail-closed)              │
│  Infrastructure: repositories (I*Repository) → banco             │
└──────────────────────────────────────────────────────────────────┘
```

### Autenticação (padrão)

1. App faz login via provedor (Universal Login) → recebe **JWT**.
2. JWT guardado em `expo-secure-store` (Keychain).
3. `api-client` anexa `Authorization: Bearer <jwt>` em toda requisição.
4. Backend **valida o JWT** e o guard resolve `userId`/tenant → aplica fail-closed.

> O provedor de auth é uma decisão de projeto (ADR). Isole-o atrás de
> `IAuthProvider` para poder trocá-lo.

### Notificações push e jobs agendados

Recursos proativos (lembretes, resumos) seguem o padrão:

- **Registro**: o app pede permissão e registra o push token no backend.
- **Agendador** (cron no backend) roda a lógica de negócio → decide o que enviar.
- **Envio**: backend dispara push (via serviço de push → APNs no iOS).

A lógica de "quando/como notificar" é **regra de negócio** → vive em services no
backend, testável, nunca no dispositivo.

### Estado no cliente

- **Server-state** (dados do backend): uma lib de cache/sincronização (ex.: React
  Query) — introduza quando houver mais de uma tela consumindo os mesmos dados.
- **UI-state** (efêmero, de tela): `useState`/`useReducer`; um store global
  (ex.: Zustand/Context) só quando o estado for realmente compartilhado.
- **MVP**: comece com hooks + fetch; adicione as libs quando a dor aparecer (YAGNI).

### Offline & resiliência

Rede móvel falha. Trate erro de rede como **erro técnico** (tom "tente novamente"),
mostre estados de loading/erro em toda tela e adote cache otimista só quando o
requisito aparecer.

### Exemplo concreto de stack (recomendado)

Assim como o template usa **Next.js** como exemplo do lado web, este é um conjunto
concreto que instancia bem os padrões nativos acima — cada escolha vira um ADR e
fica isolada atrás de interfaces (`I*Repository`, `IAuthProvider`):

| Camada | Escolha de exemplo | Papel |
|---|---|---|
| App | **Expo** (React Native), iOS; expo-router | Presentation + application-cliente |
| Banco | **Neon** (Postgres serverless) | Relacional, exponível via MCP |
| Backend | **Vercel** (funções serverless) + **Vercel Cron** | BFF + jobs agendados |
| Auth | **Auth0** (Universal Login, JWT) | Identidade atrás de `IAuthProvider` |
| Authz | **Guards na aplicação** (fail-closed) | Multi-tenant sem depender de RLS |
| Push | **Expo Notifications** → APNs | Notificações proativas |

> É um **ponto de partida**, não uma obrigação. Troque qualquer peça pela sua e
> registre o porquê num ADR.

---

## Padrões e Convenções

- **Dependency Injection** via construtor.
- **DTOs** para cruzar fronteiras de camadas (input e output).
- **Mappers** para converter entre formatos (domínio ↔ banco ↔ resposta).

---

## Considerações de Evolução

- **Promoção MVP → completo** (perfil `mvp-primeiro`): extrair aggregate, VOs e repositório
  para dentro do módulo; `interfaces/` e assinatura do service não mudam.
- **App nativo**: schemas Zod e DTOs dos módulos vão para `packages/shared`; services ficam
  no backend.
- **Troca de backend/banco**: novos repositórios implementando as mesmas interfaces;
  services permanecem intocados.
- **Extrair um módulo** para outro deployable (ou o MCP para `apps/mcp`): o módulo já é
  coeso e só expõe `index.ts`.

---

## Ver Também

- [BEST_PRACTICES.md](./BEST_PRACTICES.md)
- [docs/guides/](./docs/guides/)
- [docs/adr/](./docs/adr/)
