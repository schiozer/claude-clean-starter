# Arquitetura agêntica — Entrega 1 (padrão/documentação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar "Service Layer + DDD tático por módulos + borda MCP" o padrão documentado do template, com perfis arquiteturais (`mvp-primeiro` / `completo-direto`) e a skill `ddd-service-development` substituindo `post-mvp-development`.

**Architecture:** Só documentação (ADRs, docs de direção, skills, guia). Nenhum código de produto. O walking skeleton **não** é alterado nesta entrega (é a entrega 2); a doc deve deixar claro que o exemplo ainda está no layout antigo até lá.

**Tech Stack:** Markdown; tooling da raiz (`eslint`, `ripgrep`, `node`) apenas para verificação.

**Spec:** `docs/superpowers/specs/2026-10-10-arquitetura-agentica-mcp-design.md`

## Global Constraints

- Idioma: português (Brasil) na prosa; código, nomes de tools MCP e comandos em inglês.
- Perfis válidos, grafados exatamente: `mvp-primeiro`, `completo-direto`.
- Nome da skill nova, exatamente: `ddd-service-development` (pasta `.claude/skills/ddd-service-development/SKILL.md`).
- ADRs novas: `011-service-layer-ddd-modular-e-perfis.md` e `012-mcp-como-borda-agentica.md`, a partir de `docs/adr/000-template.md`, `**Status**: Aceito`, `**Data**: 2026-10-10`.
- Escopos no formato `<ctx>:read` / `<ctx>:write`; `AuthUser = { id, tenantId, scopes, via: 'session' | 'oauth' | 'pat' | 'system' }`.
- Tools de escrita: flag **desligada por padrão**; `scope` obrigatório em `defineTool`.
- Commits: `tipo(escopo): mensagem` (BEST_PRACTICES), terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Branch: `docs/arquitetura-agentica-mcp` (já criada, contém a spec). Entrega via PR (regra 8), com checagem de conta git antes do push (regra 5).
- **Não** rodar `prettier --write` em markdown da raiz (há 23 arquivos pré-existentes fora do padrão; formatá-los poluiria o diff).

### Comando de verificação de links (usado em várias tasks)

Salve mentalmente como `CHECK_LINKS`; roda da raiz e lista links relativos quebrados nos arquivos passados:

```bash
node -e '
const fs=require("fs"),path=require("path");let bad=0;
for(const f of process.argv.slice(1)){const s=fs.readFileSync(f,"utf8");
for(const m of s.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)){
const p=path.resolve(path.dirname(f),m[1]);if(!fs.existsSync(p)){console.log(f+" -> "+m[1]);bad++}}}
process.exit(bad?1:0)' ARQUIVOS...
```

Expected: nenhuma saída, exit code 0.

## Review Focus

- **Exemplo divergente da doc**: quem lê `ARCHITECTURE.md` e abre `examples/walking-skeleton/` vê o layout antigo → a doc precisa avisar que a migração do exemplo é a entrega 2 (Task 3, Step 1 inclui o aviso; Step 2 verifica com `rg`).
- **Perfil ausente/inválido no `CLAUDE.md`**: as duas skills devem mandar **perguntar** e não assumir (Tasks 5 e 6 verificam a frase "pergunte ao usuário" na seção de perfil).
- **Referência órfã à skill removida**: qualquer `post-mvp-development` restante quebra o pipeline (Task 7, Step 3: `rg` deve retornar só a spec e este plano).
- **Tool de escrita exposta por engano**: a doc deve dizer em todos os lugares que escrita nasce com flag desligada (Task 2 e Task 4 verificam "desligada por padrão").
- **Token de outra API aceito pelo MCP**: a doc deve exigir validação de `aud` = URL do MCP do ambiente (Task 2 e Task 8 verificam `aud`).

---

### Task 1: ADR-011 — Service Layer, DDD modular e perfis

**Files:**
- Create: `docs/adr/011-service-layer-ddd-modular-e-perfis.md`

**Interfaces:**
- Produces: termos citados pelas demais tasks — "porta única", `src/modules/<ctx>/`, perfis `mvp-primeiro`/`completo-direto`, 4 regras de fronteira.

- [ ] **Step 1: Escrever a ADR**

Conteúdo completo do arquivo:

````markdown
# 011. Service Layer como porta única, DDD tático por módulos e perfis arquiteturais

**Data**: 2026-10-10
**Status**: Aceito

## Contexto

O template organizava o código **por camada técnica** (`domain/`, `application/use-cases/`,
`infrastructure/`, `presentation/`), com um use-case por classe e o BFF REST como única
borda. Queremos que todo sistema nasça **agêntico**: além da UI/REST, um servidor **MCP**
que LLMs (ChatGPT, Claude, Cursor) chamam em nome do usuário — ver
[ADR-012](./012-mcp-como-borda-agentica.md).

Com mais de uma borda (REST, MCP, Cron), a regra de negócio e a autorização **não podem**
viver nas bordas: cada nova borda seria uma chance de pular um guard. Também precisamos de
um jeito explícito de dizer se um projeto passa por uma fase MVP ou não — projetos
pequenos não devem ser empurrados para "evoluir depois".

## Decisão

1. **Organização por contexto de negócio** (bounded context), não por camada técnica:

   ```
   src/modules/<ctx>/
     domain/          # só no perfil completo: Aggregates, Value Objects, I*Repository
     application/     # <Ctx>Service.ts, schemas.ts (Zod), dto.ts
     infrastructure/  # só no perfil completo: repositórios concretos
     interfaces/      # http/ (REST) e mcp/tools.ts — adaptadores finos
     index.ts         # exporta SÓ service, schemas e DTOs
   src/shared/        # kernel/, auth/, mcp/, errors/
   src/composition.ts # wiring (DI por construtor)
   ```

2. **Application Service como porta única do módulo.** Todo método público recebe
   `actor: AuthUser` como 1º parâmetro e chama um guard (escopo/posse) **antes** de tocar
   dados. Entrada e saída são DTOs validados com Zod; entidades nunca saem do service.
   REST, MCP e Cron chamam **o mesmo** service.

3. **DDD tático pragmático** (perfil completo): Aggregate Root com `create()`/`rehydrate()`
   e métodos com nome de negócio; Value Objects imutáveis que validam na construção;
   repositório por aggregate. Domain events são **opcionais** (só com consumidor real).

4. **Regras de fronteira:**
   1. Fora do módulo importa-se só `modules/<ctx>/index.ts` (ESLint `no-restricted-imports`).
   2. Contexto fala com contexto pelo **service**, nunca pelo repositório.
   3. `interfaces/*` não tem regra de negócio nem autorização.
   4. No MVP não há `domain/` nem `infrastructure/`; promover = extrair para dentro do
      módulo sem alterar `interfaces/`.

5. **Perfis arquiteturais** declarados no `CLAUDE.md` do projeto
   (`**Perfil arquitetural**: mvp-primeiro | completo-direto`):
   - `mvp-primeiro` — começa com service enxuto (skill `mvp-development`) e é promovido
     ao completo por decisão explícita (troca do campo + ADR do projeto).
   - `completo-direto` — projeto pequeno/estável **sem fase MVP**: nasce e permanece no
     completo (skill `ddd-service-development`).
   - Ausente ou inválido → o agente pergunta antes de agir (fail-closed).

6. A skill `ddd-service-development` **substitui** `post-mvp-development`.

## Consequências

- ➕ Uma borda nova (MCP, webhook, fila) custa um adaptador fino; autorização e regra são
  herdadas do service.
- ➕ Módulos coesos: tudo de um contexto mora junto; fácil de extrair para outro deployable.
- ➕ Promoção MVP → completo não quebra REST nem MCP (assinatura pública do service estável).
- ➖ Services podem crescer demais; mitigação: dividir por subcontexto quando passar de
  ~10 métodos públicos ou misturar linguagens de negócio.
- ➖ Mais um conceito para o time (perfil); mitigação: as skills leem e aplicam o perfil.
- ➖ O walking skeleton fica no layout antigo até a entrega 2 da spec
  `2026-10-10-arquitetura-agentica-mcp-design.md`.

## Alternativas Consideradas

- **Manter organização por camada técnica + use-case por classe**: espalha um contexto por
  4 pastas e não oferece uma porta única óbvia para novas bordas. Descartada.
- **DDD completo como padrão (CQRS, outbox, ACLs)**: poder desnecessário para a maioria dos
  projetos do template (YAGNI). Fica como evolução documentada por projeto.
- **Perfil único (sempre MVP → completo)**: força projetos pequenos a um ciclo que não
  precisam. Descartada a pedido do usuário.
````

- [ ] **Step 2: Verificar**

Run:
```bash
rg -c "mvp-primeiro|completo-direto" docs/adr/011-service-layer-ddd-modular-e-perfis.md
rg -n "^## (Contexto|Decisão|Consequências|Alternativas Consideradas)$" docs/adr/011-service-layer-ddd-modular-e-perfis.md
```
+ `CHECK_LINKS docs/adr/011-service-layer-ddd-modular-e-perfis.md`

Expected: contagem ≥ 4; as 4 seções listadas; links OK. (O link para a ADR-012 só existe após a Task 2 — rode `CHECK_LINKS` desta ADR de novo na Task 2.)

- [ ] **Step 3: Commit**

```bash
git add docs/adr/011-service-layer-ddd-modular-e-perfis.md
git commit -m "docs(adr): service layer, DDD modular e perfis arquiteturais (011)"
```

---

### Task 2: ADR-012 — MCP como borda agêntica

**Files:**
- Create: `docs/adr/012-mcp-como-borda-agentica.md`

**Interfaces:**
- Consumes: ADR-011 (service como porta única, `AuthUser`).
- Produces: `defineTool`, registry, `/api/mcp`, `/.well-known/oauth-protected-resource`, `IAccessTokenVerifier` (`Auth0JwtVerifier`, `PersonalTokenVerifier`), flags `mcp.<ctx>.read|write`.

- [ ] **Step 1: Escrever a ADR**

````markdown
# 012. MCP como borda agêntica (adaptador irmão do REST)

**Data**: 2026-10-10
**Status**: Aceito

## Contexto

Queremos que LLMs — em especial o **ChatGPT** (connectors / modo desenvolvedor), além de
Claude e Cursor — consultem e operem nossos sistemas **em nome do usuário logado**. O
protocolo padrão para isso é o **Model Context Protocol (MCP)**: o sistema expõe *tools*
via HTTP e o cliente as descobre e chama. O ChatGPT conecta-se a servidores MCP remotos
autenticados por **OAuth**.

Restrições: app serverless na Vercel (ADR-001), Auth0 por ambiente (ADR-004), toggles por
feature (ADR-006), erros funcional vs técnico (ADR-009), rate limit em Postgres (ADR-010) e
o service como porta única (ADR-011).

## Decisão

1. **MCP é um adaptador em `interfaces/mcp/` de cada módulo**, irmão do REST, que chama o
   mesmo `<Ctx>Service`. Nenhuma regra de negócio ou autorização vive na tool.

2. **Declaração de tools** com `defineTool` (`src/shared/mcp/`):

   ```ts
   defineTool({
     name: 'list_resources',                 // verbo_substantivo, snake_case
     description: 'Lista os recursos do usuário. Use para responder "quais são meus recursos".',
     input: listResourcesSchema,             // mesmo Zod do REST
     scope: 'resources:read',                // obrigatório
     annotations: { readOnlyHint: true },
     flag: 'mcp.resources.read',
     handler: (actor, input) => services.resource.list(actor, input),
   })
   ```

   Tools de escrita usam `readOnlyHint: false` (e `destructiveHint` quando apaga/sobrescreve)
   e nascem com a flag **desligada por padrão**.

3. **Servidor único** em `app/api/mcp/route.ts`, com o SDK oficial
   `@modelcontextprotocol/sdk`, transporte **Streamable HTTP stateless**. O registry agrega
   as tools de todos os módulos e **lista só** as que têm flag ligada **e** escopo presente
   no token; o service revalida o escopo (defesa em profundidade).

4. **Autenticação — o MCP é um OAuth Resource Server:**
   - `GET /.well-known/oauth-protected-resource` publica o metadado (RFC 9728) apontando o
     **tenant Auth0 do ambiente** como authorization server.
   - Sem token / token inválido → HTTP `401` com
     `WWW-Authenticate: Bearer resource_metadata="<url do metadado>"`.
   - `IAccessTokenVerifier` com dois adaptadores, ambos produzindo `AuthUser`:
     - `Auth0JwtVerifier` — JWKS, `iss`, **`aud` = URL do MCP do ambiente**, `exp`, escopos.
     - `PersonalTokenVerifier` — tokens `pat_<random>` guardados **só como hash SHA-256**,
       com escopos, `expiresAt`, `revokedAt`, `lastUsedAt`.
   - Escolha do verificador pelo formato (`pat_` → PAT; senão → JWT).
   - Fora do Dev local, só HTTPS.

5. **Escopos** `<ctx>:read` / `<ctx>:write` vêm do token (OAuth ou PAT) e da sessão web
   (escopos do papel do usuário). Tenant/owner **sempre** derivados do `actor`, nunca do
   input da LLM.

6. **Erros:** falha de autenticação → HTTP `401`. Demais erros → resultado MCP com
   `isError: true`; funcionais com mensagem acionável para a LLM, técnicos com mensagem
   genérica sem detalhes internos (ADR-009).

7. **Operação:** rate limit por ator (ADR-010) e log de auditoria de toda tool de escrita
   (ator, tool, horário, resultado; sem payload sensível). Cada ambiente (UAT/Prod) tem seu
   próprio endpoint MCP e seu próprio tenant Auth0.

## Consequências

- ➕ Todo sistema do template fica acessível a qualquer cliente MCP com o mesmo endpoint.
- ➕ A LLM enxerga só o que o usuário enxergaria; sem caminho que pule guards.
- ➕ Nada de infraestrutura nova: mesma função serverless, mesmo pipeline PR → UAT → Prod.
- ➖ Configuração extra no Auth0 (API com audience = URL do MCP, registro dinâmico de
  cliente, escopos) por ambiente — ver `docs/guides/mcp-guide.md`.
- ➖ Descrições de tools viram "UX para LLM" e precisam de revisão como copy.
- ➖ Sem sessão MCP (stateless): sem notificações server→client. Aceito.

## Alternativas Consideradas

- **MCP como deployable separado (`apps/mcp`)**: isolamento e escala próprios, mas dobra
  projetos, ambientes e segredos. Reavaliar quando o tráfego MCP divergir do web.
- **Gerar MCP a partir da API REST/OpenAPI**: tools "com cara de endpoint", descrições
  ruins para LLM, payloads grandes, salto HTTP extra, sem anotações confiáveis. Descartada.
- **Só token pessoal (sem OAuth)**: simples, mas o ChatGPT trabalha com OAuth para
  connectors autenticados. Mantido apenas como alternativa.
````

- [ ] **Step 2: Verificar**

Run:
```bash
rg -n "desligada por padrão" docs/adr/012-mcp-como-borda-agentica.md
rg -n "aud\` = URL do MCP" docs/adr/012-mcp-como-borda-agentica.md
```
+ `CHECK_LINKS docs/adr/011-service-layer-ddd-modular-e-perfis.md docs/adr/012-mcp-como-borda-agentica.md`

Expected: as duas linhas encontradas; links OK.

- [ ] **Step 3: Commit**

```bash
git add docs/adr/012-mcp-como-borda-agentica.md
git commit -m "docs(adr): MCP como borda agêntica com OAuth Auth0 e PAT (012)"
```

---

### Task 3: ARCHITECTURE.md — módulos, Service Layer, DDD tático e borda MCP

**Files:**
- Modify: `ARCHITECTURE.md` — trechos atuais: `### 2. Clean Architecture` (l.37–57), `## Estrutura de Diretórios (Pós-MVP)` (l.59–91), `## Camadas Detalhadas` (l.93–201), `## Autorização` (l.203–221), `## Considerações de Evolução` (l.365–372), `### Estrutura recomendada (monorepo)` (l.257–275).

**Interfaces:**
- Consumes: ADR-011, ADR-012 (mesmos nomes e estruturas).

- [ ] **Step 1: Editar**

1. Em `## Visão Geral`, substitua o último parágrafo ("O projeto pode começar **simples (MVP)**…") por:

```markdown
Todo projeto declara um **perfil arquitetural** no `CLAUDE.md` — `mvp-primeiro`
(começa enxuto e é promovido) ou `completo-direto` (sem fase MVP) — ver
[ADR-011](./docs/adr/011-service-layer-ddd-modular-e-perfis.md). Em ambos, o sistema é
**agêntico**: além da UI/REST, expõe um servidor **MCP** que LLMs chamam em nome do
usuário ([ADR-012](./docs/adr/012-mcp-como-borda-agentica.md)).

> ⚠️ O exemplo em `examples/walking-skeleton/` ainda usa o layout por camada técnica;
> a migração para `modules/` + MCP é a entrega 2 da spec
> `docs/superpowers/specs/2026-10-10-arquitetura-agentica-mcp-design.md`.
```

2. Substitua `### 2. Clean Architecture` inteiro (bloco do diagrama + "Regra de Dependência") por:

````markdown
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
````

3. Substitua `## Estrutura de Diretórios (Pós-MVP)` inteiro (até o `---` antes de `## Camadas Detalhadas`) por:

````markdown
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
│       └── index.ts                   # exporta SÓ service, schemas e DTOs
├── shared/
│   ├── kernel/                        # Entity, ValueObject, AggregateRoot (só no completo)
│   ├── auth/                          # AuthUser, IAccessTokenVerifier, guards genéricos
│   ├── mcp/                           # defineTool, registry, servidor
│   └── errors/                        # AppError & cia (ADR-009)
├── composition.ts                     # wiring: repos → services (DI por construtor)
└── app/                               # Next.js: app/api/<ctx>/route.ts e app/api/mcp/route.ts só delegam
```

### Regras de fronteira

1. Fora do módulo, importa-se **só** `modules/<ctx>/index.ts` (ESLint `no-restricted-imports`).
2. Um contexto fala com outro **pelo service** do outro, nunca pelo repositório.
3. `interfaces/*` não contém regra de negócio nem autorização: valida, chama o service, traduz.
4. No perfil MVP, `domain/` e `infrastructure/` não existem; o service acessa dados direto.
   Promoção = **extrair para dentro** do módulo, sem alterar `interfaces/`.
````

4. Substitua `## Camadas Detalhadas` inteiro (subseções 1–4, até o `---` antes de `## Autorização`) por:

````markdown
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
    if (this._published) throw new DomainError('Recurso já publicado', 'ALREADY_PUBLISHED')
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
export async function POST(req: Request) {
  try {
    const actor = await resolveActor(req)               // sessão → AuthUser (ou 401)
    const input = createResourceSchema.parse(await req.json())
    return json(await services.resource.create(actor, input), 201)
  } catch (error) {
    return handleAPIError(error)
  }
}
```

**MCP** — ver a seção "Borda agêntica (MCP)" abaixo.

**UI** — componentes delegam a hooks; hooks chamam a API REST e gerenciam loading/error/data.

---

## Borda agêntica (MCP)

Detalhes e justificativas em [ADR-012](./docs/adr/012-mcp-como-borda-agentica.md); passo a
passo de conexão em [docs/guides/mcp-guide.md](./docs/guides/mcp-guide.md).

```typescript
// src/modules/resources/interfaces/mcp/tools.ts
export const resourceTools = [
  defineTool({
    name: 'list_resources',
    description: 'Lista os recursos do usuário. Use para responder "quais são meus recursos".',
    input: listResourcesSchema,
    scope: 'resources:read',
    annotations: { readOnlyHint: true },
    flag: 'mcp.resources.read',
    handler: (actor, input) => services.resource.list(actor, input),
  }),
  defineTool({
    name: 'create_resource',
    description: 'Cria um recurso com o título informado.',
    input: createResourceSchema,
    scope: 'resources:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    flag: 'mcp.resources.write', // escrita: desligada por padrão
    handler: (actor, input) => services.resource.create(actor, input),
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
- `Auth0JwtVerifier` valida JWKS, `iss`, **`aud` = URL do MCP do ambiente**, `exp`, escopos.
- `PersonalTokenVerifier`: tokens `pat_…` guardados só como hash SHA-256, com escopos,
  expiração e revogação.
- Erros: autenticação → HTTP 401; demais → `isError: true` (funcional = acionável,
  técnico = genérico).
- Rate limit por ator (ADR-010) e auditoria das tools de escrita.
````

5. Em `## Autorização`, troque o primeiro bullet ("**Padrão — guards na camada de aplicação**…") por:

```markdown
- **Padrão — guards no Application Service** (`requireScope`, `assertOwnership`),
  chamados por **todo** método público do `<Ctx>Service` antes de tocar dados. A
  identidade chega como `AuthUser` (sessão web, OAuth/JWT do IdP ou token pessoal),
  com **escopos** `<ctx>:read|write`; a regra de acesso vive no código, testável e
  versionada. Como REST, MCP e Cron passam pelo mesmo service, nenhuma borda pula a
  autorização. Combina com um Postgres "puro" (ex.: Neon) atrás de `I*Repository` e um
  IdP externo (ex.: Auth0) atrás de `IAccessTokenVerifier`.
```

6. Em `### Estrutura recomendada (monorepo)` (seção nativa), troque a linha
`│   └── api/               # backend (serverless / Node) — use-cases + repositories` por
`│   └── api/               # backend (serverless / Node) — src/modules/<ctx>/ (services, repos, http, mcp)`
e a linha `│   └── shared/            # domain/ + validators (Zod) — reusado por mobile e api` por
`│   └── shared/            # schemas Zod + DTOs dos módulos — reusado por mobile e api`.

7. Substitua `## Considerações de Evolução` (bullets) por:

```markdown
- **Promoção MVP → completo** (perfil `mvp-primeiro`): extrair aggregate, VOs e repositório
  para dentro do módulo; `interfaces/` e assinatura do service não mudam.
- **App nativo**: schemas Zod e DTOs dos módulos vão para `packages/shared`; services ficam
  no backend.
- **Troca de backend/banco**: novos repositórios implementando as mesmas interfaces;
  services permanecem intocados.
- **Extrair um módulo** para outro deployable (ou o MCP para `apps/mcp`): o módulo já é
  coeso e só expõe `index.ts`.
```

- [ ] **Step 2: Verificar**

Run:
```bash
rg -n "Pós-MVP|use-cases/|CreateResourceUseCase" ARCHITECTURE.md
rg -n "walking-skeleton" ARCHITECTURE.md
rg -c "modules/" ARCHITECTURE.md
```
+ `CHECK_LINKS ARCHITECTURE.md`

Expected: 1º comando sem resultados; 2º encontra o aviso; 3º ≥ 5; `CHECK_LINKS` falha **apenas** em `docs/guides/mcp-guide.md` (criado na Task 8 — anote e confira lá).

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs(arch): módulos por contexto, service layer, DDD tático e borda MCP"
```

---

### Task 4: BEST_PRACTICES.md — design de tools MCP e fronteiras

**Files:**
- Modify: `BEST_PRACTICES.md` — inserir nova seção após `## Estrutura de Código` (antes de `## TypeScript`, l.92) e nova seção antes de `## Performance` (l.255); ajustar `## Checklist Antes de Commitar` (l.301).

- [ ] **Step 1: Editar**

1. Antes de `## TypeScript`, insira:

````markdown
## Módulos e Service Layer

- **Importe só pelo `index.ts`** de outro módulo (`@/modules/resources`), nunca
  `@/modules/resources/domain/...` — o ESLint (`no-restricted-imports`) barra.
- **Service recebe `actor` primeiro** e chama o guard na 1ª linha:

```typescript
// ✅
async archive(actor: AuthUser, input: ArchiveResourceInput): Promise<ResourceDTO> {
  requireScope(actor, 'resources:write')
  const resource = await this.repo.findById(input.id)
  if (!resource) throw new NotFoundError('Recurso')
  assertOwnership(actor, resource.ownerId)
  // ...
}

// ❌ ownerId vindo do input (a LLM/cliente escolhe de quem é o dado)
async archive(input: { id: string; ownerId: string }) { /* ... */ }
```

- **Bordas finas**: handler REST e tool MCP têm só validação, chamada ao service e
  tradução de erro. Se aparecer um `if` de regra de negócio numa borda, ele pertence ao
  service.
- **Service nunca devolve entidade** — sempre DTO (`toResourceDTO`).

---
````

2. Antes de `## Performance`, insira:

````markdown
## Design de tools MCP

Tools são **UX para a LLM**: nome e descrição decidem se ela escolhe a tool certa.

- **Nome** `verbo_substantivo`, snake_case, em inglês, na linguagem do negócio
  (`list_resources`, `publish_resource`), não da tabela (`get_resource_rows`).
- **Descrição diz quando usar**, não só o que faz: "Use para responder 'quais são meus
  recursos'".
- **Orientada a tarefa**, não CRUD genérico: prefira `publish_resource` a
  `update_resource({ published: true })`.
- **Saída pequena e paginada**: `limit` ≤ 50 + `cursor`; só os campos úteis; IDs estáveis.
- **Escopo obrigatório** (`<ctx>:read|write`) e **anotações honestas**: `readOnlyHint: true`
  só se não muda nada; `destructiveHint: true` se apaga/sobrescreve.
- **Escrita nasce com a flag desligada por padrão** (`mcp.<ctx>.write`) e é ligada por
  ambiente, conscientemente (ADR-006).
- **Nunca** aceite tenant/owner no input da tool — derive do `actor`.
- **Erros**: funcional → mensagem acionável para a LLM ("Título deve ter ao menos 3
  caracteres"); técnico → genérica ("Falha temporária, tente novamente"), sem stack trace.

```typescript
// ✅
defineTool({
  name: 'publish_resource',
  description: 'Publica um recurso do usuário. Use quando ele pedir para publicar/tornar visível.',
  input: z.object({ id: z.string().uuid() }),
  scope: 'resources:write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  flag: 'mcp.resources.write',
  handler: (actor, input) => services.resource.publish(actor, input),
})

// ❌ genérica, sem escopo de tarefa, aceita ownerId
defineTool({ name: 'update', description: 'Atualiza', input: z.any(), /* ... */ })
```

---
````

3. Em `## Checklist Antes de Commitar`, acrescente ao final da lista:

```markdown
- [ ] Novo método de service: recebe `actor` e chama guard antes de tocar dados
- [ ] Nova tool MCP: `scope` + anotações corretas + flag (escrita desligada por padrão)
```

- [ ] **Step 2: Verificar**

Run:
```bash
rg -n "^## (Módulos e Service Layer|Design de tools MCP)$" BEST_PRACTICES.md
rg -n "desligada por padrão" BEST_PRACTICES.md
rg -n "z\.any\(\)" BEST_PRACTICES.md
```
+ `CHECK_LINKS BEST_PRACTICES.md`

Expected: 2 seções; ≥ 2 linhas "desligada por padrão"; `z.any()` só no exemplo ❌; links OK.

- [ ] **Step 3: Commit**

```bash
git add BEST_PRACTICES.md
git commit -m "docs(practices): service layer por módulo e design de tools MCP"
```

---

### Task 5: Skill `ddd-service-development` (substitui `post-mvp-development`)

**Files:**
- Create: `.claude/skills/ddd-service-development/SKILL.md`
- Delete: `.claude/skills/post-mvp-development/SKILL.md` (e a pasta)

**Interfaces:**
- Consumes: ADR-011, ADR-012, seções da Task 3/4.
- Produces: nome `ddd-service-development` referenciado por CLAUDE.md/SKILLS.md/README (Task 7).

- [ ] **Step 1: Criar a skill**

````markdown
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
````

- [ ] **Step 2: Remover a skill antiga**

```bash
git rm -r .claude/skills/post-mvp-development
```

- [ ] **Step 3: Verificar**

Run:
```bash
ls .claude/skills
rg -n "^name: ddd-service-development$" .claude/skills/ddd-service-development/SKILL.md
rg -n "pergunte ao usuário" .claude/skills/ddd-service-development/SKILL.md
```

Expected: `ddd-service-development  mvp-development`; frontmatter encontrado; ≥ 1 "pergunte ao usuário" na seção de perfil.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/ddd-service-development
git commit -m "feat(skills): ddd-service-development substitui post-mvp-development"
```

---

### Task 6: Skill `mvp-development` — service enxuto, MCP e guarda de perfil

**Files:**
- Modify (reescrita completa): `.claude/skills/mvp-development/SKILL.md`

- [ ] **Step 1: Reescrever**

````markdown
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
export const resourceTools = [
  defineTool({
    name: 'list_resources',
    description: 'Lista os recursos do usuário. Use para responder "quais são meus recursos".',
    input: listResourcesSchema,
    scope: 'resources:read',
    annotations: { readOnlyHint: true },
    flag: 'mcp.resources.read',
    handler: (actor, input) => services.resource.list(actor, input),
  }),
]
```

```typescript
// src/presentation/hooks/useResources.ts
export function useResources() {
  const [resources, setResources] = useState<ResourceDTO[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { void fetchResources() }, [])

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

## Checklist (MVP)

- [ ] Perfil verificado no `CLAUDE.md`
- [ ] Service: `actor` primeiro, guard antes de dados, DTO na saída
- [ ] Validação Zod na borda (mesmo schema em REST e MCP)
- [ ] Tool MCP perguntada ao usuário (expor? flag?); escrita desligada por padrão
- [ ] Erros funcional vs técnico (ver BEST_PRACTICES)
- [ ] Loading/erro na UI; TypeScript sem `any`
- [ ] Testes do service (escopo, isolamento por owner) e dos hooks críticos

## Promoção para o Completo

Quando surgir regra que cruza entidades, invariantes ricas ou necessidade de trocar
infraestrutura, **proponha** a promoção ao usuário (nunca promova sozinho). Se aceita:

1. Registrar ADR do projeto ("promoção do módulo/projeto ao perfil completo").
2. Trocar o `CLAUDE.md` para indicar que o projeto foi promovido.
3. Por módulo: extrair VOs/aggregate para `domain/`, criar `I<Agg>Repository` e o
   repositório em `infrastructure/`, injetar no service. **Não** alterar `interfaces/` nem
   a assinatura pública do service — os testes de REST/MCP devem passar sem mudança.
4. Seguir daí com `ddd-service-development`.
````

- [ ] **Step 2: Verificar**

Run:
```bash
rg -n "post-mvp-development|SEM use-cases" .claude/skills/mvp-development/SKILL.md
rg -n "completo-direto|pergunte ao usuário" .claude/skills/mvp-development/SKILL.md
```

Expected: 1º sem resultados; 2º com ≥ 3 linhas.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/mvp-development/SKILL.md
git commit -m "feat(skills): mvp-development com service enxuto, MCP e guarda de perfil"
```

---

### Task 7: CLAUDE.md, SKILLS.md e README.md — perfil e referências

**Files:**
- Modify: `CLAUDE.md` (topo, regra 1 l.32, regra 2 l.42–45, árvore l.112–137, seção "MVP vs Pós-MVP" l.141–164, checklist, comunicação l.266)
- Modify: `SKILLS.md` (l.17, l.38–39)
- Modify: `README.md` (l.13, l.18, l.50, l.58–59)

- [ ] **Step 1: `CLAUDE.md`**

1. Logo abaixo de `**Versão do template**: 1.0.0`, adicione:

```markdown
**Perfil arquitetural**: <mvp-primeiro | completo-direto>

> Preencha ao adotar o template ([ADR-011](./docs/adr/011-service-layer-ddd-modular-e-perfis.md)).
> `mvp-primeiro` = começa enxuto e é promovido por decisão explícita;
> `completo-direto` = projeto pequeno, **sem fase MVP**. Se estiver vazio ou inválido,
> o Claudinho **pergunta** antes de implementar.
```

2. Em todos os blocos de pipeline, troque
`brainstorming → writing-plans → [mvp-development | post-mvp-development] → verification-before-completion` por
`brainstorming → writing-plans → [mvp-development | ddd-service-development] (conforme o perfil) → verification-before-completion`.

3. Substitua o conteúdo da regra `### 2. **Skills de Implementação**` por:

```markdown
A skill de implementação é escolhida pelo **Perfil arquitetural** (topo deste arquivo):

- `mvp-primeiro` (não promovido): `mvp-development` — módulos com Service enxuto + REST + MCP.
- `completo-direto` ou `mvp-primeiro` promovido: `ddd-service-development` — módulos com
  DDD tático + Service + REST + MCP.
- Perfil vazio/inválido: **pergunte** ao usuário antes de implementar.

Em ambos, toda capacidade nova pergunta se deve virar **tool MCP** e com qual flag
(escrita nasce desligada) — ver [ADR-012](./docs/adr/012-mcp-como-borda-agentica.md).
```

4. Na árvore de `## 📁 Estrutura do Projeto`, substitua o bloco de `├── src/` até antes de `├── tests/` por:

```
├── src/
│   ├── modules/<contexto>/        # domain/ (completo), application/ (Service), infrastructure/ (completo), interfaces/{http,mcp}
│   ├── shared/                    # kernel/, auth/, mcp/, errors/
│   ├── composition.ts             # wiring repos → services
│   └── app/                       # rotas (Next.js): api/<ctx>, api/mcp
```

e a linha `│   └── skills/                    # Skills MVP e Pós-MVP` por
`│   └── skills/                    # mvp-development, ddd-service-development`.

5. Substitua a seção `## 🎯 MVP vs Pós-MVP` inteira (até o `---` seguinte) por:

```markdown
## 🎯 Perfis: MVP vs Completo

Em **ambos** os perfis: módulos por contexto, `<Ctx>Service` como porta única (`actor`
primeiro + guard), Zod nas bordas, REST + MCP finos, autorização no servidor.

### MVP (`mvp-primeiro`, antes da promoção)

- ✅ Service acessa o banco direto
- ✅ Hooks (useState + useEffect); Context só para auth
- ❌ SEM aggregates, value objects e repositórios
- ❌ SEM server-state (React Query) até precisar

### Completo (`completo-direto`, ou `mvp-primeiro` promovido)

- ✅ DDD tático: aggregates, value objects, repositórios (interface + implementação)
- ✅ Domain events só com consumidor real
- ✅ Server-state/UI-state quando fizer sentido
- ✅ Testes robustos (unit, integration REST + MCP, E2E)

Ver as skills `mvp-development` e `ddd-service-development` e a
[ADR-011](./docs/adr/011-service-layer-ddd-modular-e-perfis.md).
```

6. Em `## 📋 Checklist Antes de Commitar`, após `- [ ] Autorização no servidor (se nova entidade/rota)`, adicione:
`- [ ] Tool MCP (se exposta): \`scope\` + anotações + flag (escrita desligada por padrão)`

7. Em `## 📚 Guias Técnicos`, adicione:
`- **MCP (conectar ChatGPT/Claude)** → [docs/guides/mcp-guide.md](./docs/guides/mcp-guide.md)`

8. Em `## 🤝 Comunicação com o Usuário`, troque `(por que MVP vs Pós-MVP, etc.)` por `(perfil MVP vs completo, expor ou não via MCP, etc.)`.

- [ ] **Step 2: `SKILLS.md` e `README.md`**

`SKILLS.md`:
- Pipeline (l.17): mesma troca do Step 1.2.
- Após o parágrafo "Antes de invocar qualquer skill…", adicione:
  `Leia também o **Perfil arquitetural** no \`CLAUDE.md\` — ele decide entre \`mvp-development\` e \`ddd-service-development\` (ver ADR-011).`
- Tabela "Construção" — substitua as linhas de `mvp-development` e `post-mvp-development` por:

```markdown
| `mvp-development` | Projeto | Perfil `mvp-primeiro` (antes da promoção). Módulos com Service enxuto + REST + MCP; sem aggregates/repositórios. |
| `ddd-service-development` | Projeto | Perfil `completo-direto` ou promovido. Módulos com DDD tático + Service + REST + MCP. |
```

`README.md`:
- l.13: `├── ARCHITECTURE.md      # Clean Architecture, SOLID, camadas, MVP vs Pós-MVP` → `├── ARCHITECTURE.md      # Módulos por contexto, Service Layer, DDD tático, borda MCP`
- l.18: `│   └── skills/          # mvp-development, post-mvp-development (gerais)` → `│   └── skills/          # mvp-development, ddd-service-development (gerais)`
- linha de `guides/`: `│   ├── guides/          # zod, testing, error-handling` → `│   ├── guides/          # zod, testing, error-handling, deploy-ci, mcp`
- Pipeline (l.50): mesma troca do Step 1.2.
- Em "Como usar", após o passo 3, insira um novo passo 4 (renumerando os seguintes):
  `4. **Declare o perfil arquitetural** no topo do \`CLAUDE.md\` (\`mvp-primeiro\` ou \`completo-direto\`).`
- `## Filosofia`: substitua o parágrafo por:

```markdown
Qualidade > velocidade. Todo sistema nasce **agêntico**: a regra de negócio vive num
Service por contexto, e REST e **MCP** (para ChatGPT, Claude, Cursor…) são bordas finas
sobre ele. Projetos `mvp-primeiro` começam enxutos e evoluem para DDD tático quando a
complexidade justificar; projetos `completo-direto` já nascem completos.
```

- [ ] **Step 3: Verificar**

Run:
```bash
rg -l "post-mvp-development" .
rg -n "Pós-MVP" CLAUDE.md SKILLS.md README.md
rg -n "Perfil arquitetural" CLAUDE.md SKILLS.md README.md
```
+ `CHECK_LINKS CLAUDE.md SKILLS.md README.md`

Expected: 1º retorna **só** `./docs/superpowers/specs/2026-10-10-arquitetura-agentica-mcp-design.md` e `./docs/superpowers/plans/2026-10-10-arquitetura-agentica-mcp-entrega-1.md`; 2º sem resultados; 3º encontra CLAUDE.md e SKILLS.md; links OK exceto `docs/guides/mcp-guide.md` (Task 8).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md SKILLS.md README.md
git commit -m "docs: perfil arquitetural e skills por perfil em CLAUDE/SKILLS/README"
```

---

### Task 8: Guia `docs/guides/mcp-guide.md`

**Files:**
- Create: `docs/guides/mcp-guide.md`

- [ ] **Step 1: Escrever o guia**

````markdown
# Guia: MCP — conectar ChatGPT, Claude e Cursor ao seu sistema

> Decisão em [ADR-012](../adr/012-mcp-como-borda-agentica.md). Este guia é o passo a passo
> operacional. Nomes de menus de terceiros (ChatGPT, Auth0) mudam com frequência — se algo
> não bater, confira a documentação atual do fornecedor.

## Visão geral

```
Cliente MCP (ChatGPT) ──HTTPS──► https://<ambiente>/api/mcp
   │ 1. sem token → 401 + WWW-Authenticate (resource_metadata)
   │ 2. lê /.well-known/oauth-protected-resource → Auth0 do ambiente
   │ 3. registro dinâmico de cliente + login do usuário no Auth0
   └ 4. chama tools com Authorization: Bearer <jwt>
```

Cada ambiente tem seu endpoint e seu tenant Auth0 (ADR-004): conecte o ChatGPT ao **UAT**
para testar e ao **Prod** só depois do merge.

## 1. Configurar o Auth0 (por ambiente)

1. **API (resource server)**: Applications → APIs → *Create API*.
   - *Identifier* (audience) = **URL exata do MCP do ambiente**, ex.:
     `https://<projeto>-uat.vercel.app/api/mcp`. O `Auth0JwtVerifier` rejeita tokens com
     outro `aud`.
   - *Permissions*: crie os escopos de cada módulo exposto, ex.: `resources:read`,
     `resources:write`.
2. **Registro dinâmico de cliente**: em Settings → Advanced, habilite o *Dynamic
   Client Registration* (registro OIDC dinâmico). O ChatGPT usa isso para se registrar
   sozinho.
3. **Conexões**: a conexão de login (ex.: Username-Password ou Google) precisa estar
   disponível para apps registrados dinamicamente (conexão de domínio/"domain level").
4. **Indicador de recurso**: a spec do MCP pede o parâmetro `resource` (RFC 8707). Confira
   se o tenant aceita `resource` ou se exige `audience`; ajuste o metadado em
   `/.well-known/oauth-protected-resource` conforme.
5. Variáveis do app (por ambiente, nunca commitadas):
   `AUTH0_ISSUER_BASE_URL`, `MCP_RESOURCE_URL` (= audience).

## 2. Ligar as tools

As tools ficam atrás de flags (ADR-006):

| Flag | Padrão | Efeito |
|---|---|---|
| `mcp.<ctx>.read` | ligada | tools de leitura do módulo aparecem |
| `mcp.<ctx>.write` | **desligada** | tools de escrita aparecem (se o token tiver `<ctx>:write`) |

Ligue a escrita **por ambiente**, conscientemente — comece pelo UAT.

## 3. Conectar o ChatGPT

1. Ative o **modo desenvolvedor** nas configurações do ChatGPT (área de Apps/Connectors,
   opções avançadas). Requer um plano que suporte connectors customizados.
2. Crie um connector/app com a URL `https://<projeto>-uat.vercel.app/api/mcp` e
   autenticação **OAuth**.
3. O ChatGPT abre o login do Auth0 do UAT → entre com um usuário de teste → consinta os
   escopos.
4. Num chat novo, habilite o connector e pergunte: *"quais são meus recursos?"*.
5. Esperado: a resposta lista **só** os recursos daquele usuário. Tools de escrita só
   aparecem com a flag de escrita ligada e o escopo concedido; o ChatGPT pede confirmação
   antes de executá-las.

## 4. Conectar Claude / Cursor

- **Claude (desktop/web)**: adicione um *custom connector* com a mesma URL; o fluxo OAuth é
  o mesmo.
- **Cursor / scripts**: use um **token pessoal** no header:

```json
{
  "mcpServers": {
    "meu-sistema-uat": {
      "url": "https://<projeto>-uat.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer pat_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

## 5. Tokens pessoais (PAT)

- Gerados pelo próprio usuário no sistema, com **escopos** e **expiração**; exibidos uma
  única vez.
- Guardados só como hash SHA-256; podem ser revogados a qualquer momento.
- Nunca compartilhe nem commite um PAT. Trate-o como senha.

## 6. Testar localmente

- Rode o app (`npm run dev`) e use o **MCP Inspector**
  (`npx @modelcontextprotocol/inspector`) apontando para `http://localhost:3000/api/mcp`.
- No Dev local, o verificador aceita um PAT de desenvolvimento (definido no seed) — não há
  OAuth real.

## Troubleshooting

| Sintoma | Causa provável |
|---|---|
| `401` mesmo após login | `aud` do token ≠ `MCP_RESOURCE_URL` (audience da API errada) |
| ChatGPT não consegue se registrar | Registro dinâmico de cliente desabilitado no tenant |
| Tool não aparece | Flag desligada ou escopo ausente no token |
| `isError` com "tente novamente" | Erro técnico — veja os logs do ambiente |
````

- [ ] **Step 2: Verificar**

Run:
```bash
rg -n "aud" docs/guides/mcp-guide.md
rg -n "desligada" docs/guides/mcp-guide.md
```
+ `CHECK_LINKS docs/guides/mcp-guide.md ARCHITECTURE.md CLAUDE.md`

Expected: linhas encontradas; **todos** os links OK agora (inclusive os apontados nas Tasks 3 e 7).

- [ ] **Step 3: Commit**

```bash
git add docs/guides/mcp-guide.md
git commit -m "docs(guide): guia MCP para conectar ChatGPT, Claude e Cursor"
```

---

### Task 9: Verificação final e PR

**Files:** nenhum novo.

- [ ] **Step 1: Verificação completa**

Run:
```bash
npm run lint
rg -l "post-mvp-development" .
```
+ `CHECK_LINKS ARCHITECTURE.md BEST_PRACTICES.md CLAUDE.md SKILLS.md README.md docs/adr/011-service-layer-ddd-modular-e-perfis.md docs/adr/012-mcp-como-borda-agentica.md docs/guides/mcp-guide.md .claude/skills/ddd-service-development/SKILL.md .claude/skills/mvp-development/SKILL.md`

Expected: lint sem erros; `rg` só spec + plano; links OK. Revisar os critérios de aceitação da **Entrega 1** na spec (§8) um a um.

- [ ] **Step 2: Atualizar status da spec**

Em `docs/superpowers/specs/2026-10-10-arquitetura-agentica-mcp-design.md`, troque `**Status**: Rascunho` por `**Status**: Aprovada` e marque os itens da Entrega 1 em §8 como `[x]`.

```bash
git commit -am "docs(spec): aprovar spec e marcar entrega 1 concluída"
```

- [ ] **Step 3: Conta git e PR** (regra 5 do CLAUDE.md + memória de multi-conta)

```bash
gh auth status --active        # conferir a conta correta para este repo; trocar se preciso
git push -u origin docs/arquitetura-agentica-mcp
gh pr create --title "docs: arquitetura agêntica (service layer + DDD modular + MCP) — entrega 1" --body "<resumo + checklist §8 Entrega 1 + 🤖 Generated with [Claude Code](https://claude.com/claude-code)>"
```

Restaurar a conta padrão da máquina ao final. **Pedir confirmação ao usuário antes do push/PR.**
