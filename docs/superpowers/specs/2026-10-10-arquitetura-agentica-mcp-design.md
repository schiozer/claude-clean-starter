# Spec: Arquitetura agêntica — Service Layer + DDD modular + borda MCP

**Data**: 2026-10-10
**Status**: Aprovada
**Autor(es)**: Fabio Schiozer, Claudinho

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano
> e a implementação.

## 1. Contexto e Objetivo

O template hoje organiza o código **por camada técnica** (`domain/`, `application/use-cases/`…)
e só expõe o sistema por REST (BFF). Queremos que **todo sistema criado a partir do template
nasça "agêntico"**: além da UI e da API REST, ele expõe um **servidor MCP** que LLMs
(ChatGPT via connectors/modo desenvolvedor, Claude, Cursor…) podem chamar **em nome do
usuário**, com a mesma autorização fail-closed da web.

Para que isso seja seguro e barato, a regra de negócio e a autorização precisam viver numa
**porta única** — o **Application Service** de cada contexto — e REST, MCP e Cron passam a
ser **adaptadores finos e irmãos** sobre ela:

```
ChatGPT/Claude ──MCP──┐
Web/Mobile ───REST────┼──► <Ctx>Service (casos de uso + guards) ──► Domínio (DDD) ──► Repositórios
Cron/Webhooks ────────┘
```

**Critério de sucesso (fim da entrega 2):** conectar o ChatGPT ao MCP do UAT do walking
skeleton, perguntar "quais são meus recursos?" e receber **apenas** os recursos do usuário
logado; `create_resource` só aparece quando a flag de escrita e o escopo `resources:write`
estão presentes.

### Decisões tomadas no brainstorming

| # | Decisão |
|---|---|
| D1 | Capacidade MCP **configurável por sistema**: o template suporta tools de leitura e escrita; cada tool tem anotações (`readOnlyHint`/`destructiveHint`) e fica atrás de feature toggle (ADR-006). |
| D2 | Autenticação do MCP: **OAuth via Auth0 (padrão, para ChatGPT) + token pessoal (alternativa)**, ambos atrás de `IAccessTokenVerifier`, produzindo o mesmo `AuthUser`. |
| D3 | **DDD tático pragmático** organizado por **módulos de contexto** (`src/modules/<ctx>/`); domain events opcionais. |
| D4 | O novo padrão **substitui** a skill `post-mvp-development` (nova skill `ddd-service-development`). |
| D5 | O MVP também expõe MCP, com **service layer mínimo** (sem aggregates/repositórios) e a mesma assinatura pública do service. |
| D6 | **Perfis arquiteturais** declarados no `CLAUDE.md`: `mvp-primeiro` (MVP → completo) e `completo-direto` (projeto pequeno, sem fase MVP: nasce e permanece no completo). |
| D7 | Borda MCP = **abordagem A**: registro de tools por módulo + endpoint único `/api/mcp` no próprio app (Streamable HTTP stateless). |
| D8 | Trabalho dividido em **duas entregas**: (1) padrão/documentação; (2) prova em código no walking skeleton. |

## 2. Não-Objetivos

- DDD "completo" como padrão: CQRS, outbox/event sourcing obrigatórios, anti-corruption
  layers formais. Ficam como evolução documentada, não como regra.
- MCP como deployable separado (abordagem B) e MCP gerado a partir de OpenAPI (abordagem C).
- Recursos MCP além de **tools** (resources, prompts, sampling, UI widgets do Apps SDK).
- MCP com sessão/estado (SSE stateful), notificações server→client.
- Publicação de um app na loja/diretório do ChatGPT.
- Migrar projetos reais existentes; o escopo é o **template** e o walking skeleton.

## 3. Fluxo do Usuário

### 3.1 Dev adotando o template

1. Copia o template e preenche **`Perfil arquitetural`** no `CLAUDE.md`.
2. Pede uma feature → `brainstorming` → `writing-plans` → skill de implementação **escolhida
   pelo perfil** (`mvp-development` ou `ddd-service-development`).
3. A skill cria/estende `src/modules/<ctx>/` com service, schemas, `interfaces/http` e
   `interfaces/mcp/tools.ts`; pergunta se cada tool precisa de toggle (ADR-006) e qual escopo.
4. Perfil ausente → o Claudinho **pergunta** antes de agir (fail-closed). Perfil
   `completo-direto` → `mvp-development` recusa e aponta para `ddd-service-development`.
5. Promoção `mvp-primeiro` → completo: decisão explícita (troca do campo + ADR curta do
   projeto); extrai domínio e repositórios **para dentro** do módulo sem tocar em `interfaces/`.

### 3.2 Usuário final via ChatGPT (entrega 2)

1. No ChatGPT, adiciona um connector apontando para `https://<uat>/api/mcp`.
2. O ChatGPT chama o MCP sem token → recebe `401` + `WWW-Authenticate` com
   `resource_metadata` → lê `/.well-known/oauth-protected-resource` → descobre o Auth0 de UAT.
3. Registro dinâmico de cliente no Auth0 → tela de login/consentimento → ChatGPT recebe o JWT.
4. `tools/list` devolve só as tools com flag ligada **e** escopo no token.
5. Usuário pergunta "quais são meus recursos?" → ChatGPT chama `list_resources` → resposta com
   os recursos do próprio usuário.
6. Desvios: token expirado/inválido → `401`; escopo ausente → tool não listada e, se chamada
   mesmo assim, erro funcional `FORBIDDEN`; rate limit → erro funcional acionável; falha de
   infra → erro técnico genérico ("tente novamente"), sem stack trace.

### 3.3 Alternativa: token pessoal

Usuário gera um token `pat_…` (escopos + expiração) e o configura em clientes que aceitam
header fixo (Claude Desktop, Cursor, scripts). Pode revogá-lo a qualquer momento.

## 4. Componentes

### 4.1 Estrutura por módulos (igual nos dois perfis)

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

**Regras de fronteira:**

1. Fora do módulo, importa-se **só** o `index.ts` (forçado por `no-restricted-imports` no ESLint).
2. Um contexto fala com outro **pelo service** do outro, nunca pelo repositório.
3. `interfaces/*` não contém regra de negócio nem autorização: valida, chama o service, traduz.
4. No MVP, `domain/` e `infrastructure/` não existem; o service acessa dados direto.
   Promoção = **extrair para dentro** do módulo, sem alterar `interfaces/`.

### 4.2 Application Service

```ts
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

- Todo método público recebe **`actor: AuthUser` como 1º parâmetro** e chama um guard antes de
  qualquer acesso a dados. Cron usa um **ator de sistema** explícito, com escopos próprios.
- `AuthUser` = `{ id, tenantId, scopes: string[], via: 'session' | 'oauth' | 'pat' | 'system' }`.
- Escopos no formato `<ctx>:read` / `<ctx>:write`. Sessão web recebe os escopos do papel do usuário.
- Entrada e saída por **DTO validado (Zod)**; o service **nunca devolve entidade**.
- Regras dependentes do objeto (ex.: posse — `assertOwnership`) ficam no service.

### 4.3 DDD tático (perfil completo)

- **Aggregate Root**: factory `create()` e `rehydrate()`; sem setters públicos; mudanças por
  métodos com nome de negócio (`publish()`, `rename()`); protege invariantes.
- **Value Objects**: validam na construção, imutáveis (`Title`, `ResourceId`).
- **Repositório por aggregate**: interface em `domain/`, implementação em `infrastructure/`.
- **Domain events (opcional)**: o aggregate registra e o service publica após o `save`. Só
  adotar quando houver um consumidor real.
- **Ubiquitous language** nos nomes de métodos e de tools MCP.

### 4.4 Borda MCP

**`defineTool`** (`shared/mcp/`), usado em `modules/<ctx>/interfaces/mcp/tools.ts`:

```ts
defineTool({
  name: 'list_resources',
  description: 'Lista os recursos do usuário. Use para responder "quais são meus recursos".',
  input: listResourcesSchema,
  scope: 'resources:read',
  annotations: { readOnlyHint: true },
  flag: 'mcp.resources.read',
  handler: (actor, input) => services.resource.list(actor, input),
})
```

**Servidor** (`shared/mcp/server.ts`, montado em `app/api/mcp/route.ts`):

- SDK oficial `@modelcontextprotocol/sdk`, transporte **Streamable HTTP stateless**.
- Registry agrega as tools de todos os módulos e **lista só** as que têm flag ligada **e**
  escopo presente no `AuthUser`; o service **revalida** o escopo (defesa em profundidade).
- Valida input com Zod → handler → serializa DTO. Erros traduzidos conforme §5.3.
- **Rate limit por ator** (reuso da ADR-010) e **auditoria** de toda tool de escrita
  (ator, tool, horário, resultado; sem payload sensível).

**Autenticação** (o MCP é um OAuth Resource Server, conforme a spec de autorização do MCP):

- `GET /.well-known/oauth-protected-resource` → metadado (RFC 9728) apontando o **Auth0 do
  ambiente** (ADR-004: tenant por ambiente) como authorization server.
- Requisição sem token/inválida → `401` com `WWW-Authenticate: Bearer resource_metadata="…"`.
- `IAccessTokenVerifier` com dois adaptadores:
  - `Auth0JwtVerifier` — assinatura via JWKS, `iss`, **`aud` = URL do MCP do ambiente**, `exp`, escopos.
  - `PersonalTokenVerifier` — token `pat_<random>`; persistido **só como hash SHA-256**, com
    escopos, `expiresAt`, `revokedAt`, `lastUsedAt`.
- O verificador é escolhido pelo formato do token (`pat_` → PAT; caso contrário → JWT).
- Fora do Dev local, só HTTPS. Nenhum segredo no cliente MCP.

### 4.5 Arquivos alterados — Entrega 1 (documentação)

| Arquivo | Mudança |
|---|---|
| `docs/adr/011-service-layer-ddd-modular-e-perfis.md` | **Nova.** Service como porta única, DDD tático por módulos, perfis, regras de fronteira. Alternativas: por camada técnica; DDD completo/CQRS. |
| `docs/adr/012-mcp-como-borda-agentica.md` | **Nova.** MCP como adaptador irmão do REST, Streamable HTTP stateless, OAuth Auth0 por ambiente + PAT, escopos, toggles, auditoria. Alternativas: deployable separado; geração via OpenAPI. |
| `ARCHITECTURE.md` | Estrutura por módulos; seções "Service Layer", "DDD tático", "Borda agêntica (MCP)"; diagrama REST/MCP/Cron → Service; seção nativa aponta para `modules/`. |
| `BEST_PRACTICES.md` | Seção "Design de tools MCP"; regras de import entre módulos; "service recebe `actor` primeiro". |
| `CLAUDE.md` | Campo `Perfil arquitetural`; regra 2 reescrita; árvore atualizada; checklist com "tool MCP com escopo + toggle". |
| `SKILLS.md` | Pipeline com a skill nova e leitura do perfil. |
| `.claude/skills/post-mvp-development/` → `.claude/skills/ddd-service-development/` | **Substitui.** Módulo, aggregate, VO, repositório, service, `interfaces/http` + `interfaces/mcp`, testes. |
| `.claude/skills/mvp-development/SKILL.md` | Service enxuto em `modules/`, MCP desde o dia 1, guarda de perfil, receita de promoção. |
| `docs/guides/mcp-guide.md` | **Novo.** Conectar ChatGPT/Claude/Cursor ao UAT; configurar Auth0 (API com audience = URL do MCP, registro dinâmico, escopos); gerar PAT. |
| `README.md` | Uma linha sobre a capacidade MCP. |

Referências às skills antigas (`post-mvp-development`) em todo o repositório devem ser
atualizadas (incluindo ADRs e guias que a citem).

### 4.6 Arquivos alterados — Entrega 2 (código, resumo)

No `examples/walking-skeleton/`:

- Migrar `domain/`, `application/`, `infrastructure/` para `src/modules/resources/` (perfil
  completo), com `ResourceService` substituindo `CreateResourceUseCase`/`ListResourcesUseCase`.
- `src/shared/{kernel,auth,mcp}`; `composition.ts` na raiz de `src/`.
- `app/api/mcp/route.ts` e `app/.well-known/oauth-protected-resource/route.ts`.
- Tools `list_resources` (flag ligada por padrão) e `create_resource` (flag **desligada** por padrão).
- `Auth0JwtVerifier`, `PersonalTokenVerifier` (repositório in-memory no skeleton) e o
  `StubAuthProvider` atual adaptado para produzir `AuthUser` com escopos no Dev local.
- Regra `no-restricted-imports` no ESLint do exemplo.

A entrega 2 terá sua própria spec curta de refinamento (se necessário) e seu próprio plano.

## 5. Regras de Negócio

### 5.1 Perfil arquitetural

- Valores válidos: `mvp-primeiro`, `completo-direto`. Ausente ou inválido → perguntar.
- `completo-direto` não tem fase MVP; as skills não sugerem simplificação para o MVP.
- `mvp-primeiro` só é promovido por decisão explícita do usuário.

### 5.2 Autorização

- Fail-closed: sem `actor` → `UnauthorizedError` (401); sem escopo ou sem posse →
  `ForbiddenError` (403, código `FORBIDDEN`). `ForbiddenError` ainda não existe no
  skeleton e será criado na entrega 2 (o código `FORBIDDEN` já é funcional pela ADR-009).
- Tool sem `scope` declarado **não compila** (campo obrigatório no `defineTool`).
- Tool sem flag ligada não é listada nem executável.
- Tools de escrita: flag **desligada por padrão**; `readOnlyHint: false` obrigatório.
- Tenant/owner sempre derivado do `actor`, **nunca** do input da LLM.

### 5.3 Erros (ADR-009)

- Service lança `AppError` com `code`.
- REST → `{ error, code }` + status.
- MCP → resultado `isError: true`; erros funcionais com mensagem acionável para a LLM;
  técnicos com mensagem genérica, sem detalhes internos. Falhas de autenticação → HTTP `401`
  (não `isError`).

### 5.4 Design de tools

- Nome `verbo_substantivo` em inglês snake_case, na linguagem do negócio.
- Descrição diz **quando** usar.
- Saída pequena e paginada (`limit` ≤ 50 + `cursor`), IDs estáveis.
- Tools orientadas a tarefa, não "CRUD genérico de tabela".

## 6. Dados / Queries

- Entrega 1: nenhum.
- Entrega 2: `personal_access_tokens` (`id`, `user_id`, `tenant_id`, `token_hash`, `scopes`,
  `created_at`, `expires_at`, `revoked_at`, `last_used_at`) — in-memory no skeleton; a
  migração SQL fica documentada para projetos reais (ADR-008). Log de auditoria de tools de
  escrita (in-memory/logger no skeleton).

## 7. Testes

**Entrega 1:** lint/format da raiz (`npm run lint`, `npm run format` em modo check), checagem
manual de links relativos nos arquivos alterados, `rg post-mvp-development` sem resultados
fora de histórico, e revisão do usuário.

**Entrega 2:**
- Unit: VOs e aggregate; `ResourceService` (escopo ausente → erro; isolamento por owner;
  DTO sem campos internos); `PersonalTokenVerifier` (hash, expiração, revogação); `defineTool`
  e filtro do registry (flag × escopo).
- Integration: `/api/mcp` — `401` + `WWW-Authenticate` sem token; `tools/list` filtrado;
  `tools/call list_resources` devolve só recursos do ator; `create_resource` invisível com flag
  desligada; erro funcional vs técnico; `/.well-known/oauth-protected-resource` válido.
  `Auth0JwtVerifier` testado com JWKS local (chave gerada no teste), incluindo `aud` errado.
- E2E manual (UAT): conectar o ChatGPT e executar o critério de sucesso da §1.

## 8. Critérios de Aceitação

**Entrega 1**
- [x] ADR-011 e ADR-012 criadas a partir do template, com Contexto/Decisão/Consequências/Alternativas.
- [x] `ARCHITECTURE.md` descreve módulos, Service Layer, DDD tático e borda MCP, com diagrama.
- [x] `BEST_PRACTICES.md` tem "Design de tools MCP" e regras de fronteira entre módulos.
- [x] `CLAUDE.md` tem `Perfil arquitetural` e a regra 2 reescrita por perfil.
- [x] `ddd-service-development` existe; `post-mvp-development` removida; nenhuma referência órfã.
- [x] `mvp-development` usa `modules/` + service enxuto + MCP e recusa em `completo-direto`.
- [x] `docs/guides/mcp-guide.md` explica conexão do ChatGPT, setup do Auth0 e PAT.
- [ ] Lint/format da raiz passando; entregue via PR (regra 8).

**Entrega 2**
- [ ] Walking skeleton migrado para `modules/resources/`; testes existentes adaptados e passando.
- [ ] `/api/mcp` funcional com `list_resources` e `create_resource` (atrás de flag).
- [ ] OAuth (Auth0) e PAT funcionando atrás de `IAccessTokenVerifier`.
- [ ] Testes da §7 passando (`npm test`, `lint`, `type-check` no exemplo).
- [ ] ChatGPT conectado ao UAT responde "quais são meus recursos?" só com os dados do usuário.
