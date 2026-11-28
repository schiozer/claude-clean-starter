# Spec: Medição de uso das tools MCP (consumo de tokens pelo produto em uso)

**Data**: 2026-11-28
**Status**: Aprovada
**Autor(es)**: Fabio Schiozer + Claudinho

> Parte B da frente "AI-BOM e consumo de tokens". A Parte A (PR #26, ADR-023) mede o consumo
> do **Claude Code no desenvolvimento**; esta mede o que o **produto em uso** faz o usuário gastar.
> Independente da Parte A: não importa código dela e pode ser mergeada em qualquer ordem.

## 1. Contexto e Objetivo

Os produtos derivados são consumidos por LLMs de terceiros via MCP (ChatGPT, Claude). **Quem paga
os tokens é o usuário do produto**, pelo próprio cliente de LLM e dentro da cota do plano dele.
O produto não gasta tokens por conta própria, mas decide quanto cada resposta de tool custa ao
usuário: uma tool que devolve 20 mil tokens consome a cota sem ele perceber. O BEST_PRACTICES já
pede saída pequena e paginada, mas nada mede se isso é cumprido.

**Objetivo:** dar ao **dono do produto** visibilidade e auditoria do uso das tools MCP: chamadas,
erros, latência e tamanho da resposta (tokens estimados), por tool (visão operacional) e por
tenant (auditoria). Serve para enxugar tools pesadas e para responder "quem usou o quê".

## 2. Não-Objetivos

- **Gateway de saída para LLM** (limite de gasto por tenant/usuário): nenhum projeto derivado
  chama um modelo com chave própria; seria código sem consumidor (YAGNI). Reabre só se aparecer um.
- **Visibilidade para o usuário final** (tela, endpoint, cota): é feature de produto, não entra.
- **Nova tool MCP ou rota REST** de consulta: o uso é só do dono; a consulta é Grafana e SQL no Neon.
- **Limite/bloqueio por tokens:** só mede. O rate limit por ator (ADR-010) continua o único freio.
- **Medir tokens reais do cliente:** o produto não os enxerga; só estimamos a resposta que ele emite.
- Não substitui o `IAuditLog` (auditoria de escritas, append-only, sem payload).

## 3. Fluxo

Não há fluxo de usuário final. Fluxo do operador (dono do produto):

1. Liga a flag `observabilidade.uso-mcp` no ambiente e cria a tabela/endpoint OTel (runbook).
2. Usuários chamam tools normalmente; cada chamada é medida no `callTool`.
3. O dono abre o painel Grafana (por tool) ou consulta a tabela diária no Neon (por tenant).

## 4. Componentes

Tudo em `shared/mcp/` do skeleton (`examples/walking-skeleton/src/shared/mcp/`):

- `usage.ts`: `IUsageMeter`, `UsageEntry`, `NullUsageMeter`, `InMemoryUsageMeter`,
  `CompositeUsageMeter`, `estimateTokens`.
- `otelUsageMeter.ts`: emite métricas OTel via `@opentelemetry/api` (no-op sem SDK registrado).
- `callTool.ts`: recebe `usage: IUsageMeter` em `CallToolDeps` e mede cada chamada.
- `featureFlags.ts`: nova flag `observabilidade.uso-mcp`.
- `composition.ts`: escolhe `NullUsageMeter` (flag desligada) ou o composto (ligada).
- Runbook, ADR-024 e SQL de referência da tabela `mcp_uso_diario` (projeto real implementa o
  `PostgresUsageMeter`, como o skeleton faz com `IAuditLog`/`IRateLimiter`).

## 5. Regras de Negócio

- **Escopo da medição:** toda chamada de **tool existente e habilitada**, leitura ou escrita.
  Tool inexistente ou com flag desligada (`NOT_FOUND`) **não é medida** (o nome vem do cliente e
  explodiria a cardinalidade). Chamada barrada por escopo ou rate limit **é medida**, com o `code`.
- **`UsageEntry`:** `{ at, tenantId, tool, outcome: 'ok'|'error', code?, latencyMs, outputTokensEst }`.
  **Nunca** args, payload, conteúdo da resposta nem `actorId` (o menor dado que cumpre a auditoria
  por tenant).
- **`outputTokensEst`** = `ceil(caracteres do texto da resposta / 4)`, documentado como
  **estimativa**; vale também para respostas de erro.
- **Fail-open:** falha do medidor é logada (`logError`) e nunca vira erro para a LLM nem altera o
  resultado da tool. O registro tem timeout curto (500 ms) para não atrasar a resposta.
- **Cardinalidade:** no OTel os rótulos são só `tool` e `resultado` (`ok` | código do erro).
  **Tenant nunca vira rótulo de métrica**; só existe na tabela do Neon.
- **Flag desligada:** `NullUsageMeter`; o `callTool` se comporta exatamente como hoje.
- Não substitui nem altera o `IAuditLog`: escrita continua auditada como hoje.

## 6. Dados / Queries

OTel (métricas): `mcp_tool_calls_total{tool,resultado}`, histograma
`mcp_tool_output_tokens_est{tool}`, histograma `mcp_tool_duration_ms{tool}`.

Neon, tabela agregada por dia (upsert incremental, uma linha por dia/tenant/tool):

```sql
CREATE TABLE mcp_uso_diario (
  dia date NOT NULL, tenant_id text NOT NULL, tool text NOT NULL,
  chamadas int NOT NULL DEFAULT 0, erros int NOT NULL DEFAULT 0,
  tokens_saida_est bigint NOT NULL DEFAULT 0, duracao_ms_total bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, tenant_id, tool)
);
-- por chamada: INSERT ... ON CONFLICT (dia, tenant_id, tool) DO UPDATE SET chamadas = mcp_uso_diario.chamadas + 1, ...
```

Consulta típica: tokens estimados por tool no mês (`GROUP BY tool`) e por tenant (`GROUP BY tenant_id`).
Uma escrita por chamada é aceitável (as tools já fazem I/O); sem buffer em memória porque em
serverless ele se perderia.

## 7. Requisitos não funcionais

Segue o baseline. Restrição interna (não é desvio de RNF): o registro do medidor adiciona no
máximo 500 ms à chamada, com timeout (CT-MCPU-005). Segurança: sem payload nem dado pessoal;
tenant só no Neon.

## 8. Cenários de teste

### CT-MCPU-001 — Chamada com sucesso é medida

Tipo: @sistemico Fora da regressão: tooling coberto por Vitest em tests/unit (sem Playwright)
Critério: CA-1 Perfil: time interno

Dado que a flag "observabilidade.uso-mcp" está ligada
Quando um ator chama a tool "list_resources" e ela responde
Então o medidor recebe uma entrada com a tool, o tenant, "ok", a latência e os tokens estimados
E a resposta da tool é a mesma de sempre

### CT-MCPU-002 — Erro de escopo é medido com o código

Tipo: @sistemico Fora da regressão: tooling coberto por Vitest em tests/unit (sem Playwright)
Critério: CA-2 Perfil: time interno

Dado que a flag está ligada e o ator não tem o escopo da tool
Quando ele chama a tool
Então o medidor registra "error" com o código do erro

### CT-MCPU-003 — Tool inexistente não é medida

Tipo: @sistemico Fora da regressão: tooling coberto por Vitest em tests/unit (sem Playwright)
Critério: CA-3 Perfil: time interno

Dado que a flag está ligada
Quando um ator chama uma tool que não existe
Então nada é registrado no medidor

### CT-MCPU-004 — Falha do medidor não afeta a tool

Tipo: @sistemico Fora da regressão: tooling coberto por Vitest em tests/unit (sem Playwright)
Critério: CA-4 Perfil: time interno

Dado que o medidor lança erro ao registrar
Quando um ator chama uma tool válida
Então a tool devolve o resultado normal
E o erro do medidor é logado

### CT-MCPU-005 — Medidor lento não atrasa a resposta

Tipo: @sistemico Fora da regressão: tooling coberto por Vitest em tests/unit (sem Playwright)
Critério: CA-4 Perfil: time interno

Dado que o medidor demora mais que o timeout para registrar
Quando um ator chama uma tool válida
Então a resposta volta sem esperar além do timeout

### CT-MCPU-006 — Flag desligada não mede

Tipo: @sistemico Fora da regressão: tooling coberto por Vitest em tests/unit (sem Playwright)
Critério: CA-5 Perfil: time interno

Dado que a flag "observabilidade.uso-mcp" está desligada
Quando um ator chama uma tool válida
Então nenhuma medição é feita e o comportamento é idêntico ao atual

### CT-MCPU-007 — Entrada nunca carrega payload

Tipo: @sistemico Fora da regressão: tooling coberto por Vitest em tests/unit (sem Playwright)
Critério: CA-6 Perfil: time interno

Dado que a flag está ligada
Quando um ator chama uma tool com argumentos e recebe uma resposta
Então a entrada registrada não contém argumentos, conteúdo da resposta nem id do ator

### CT-MCPU-008 — Métricas OTel sem tenant

Tipo: @sistemico Fora da regressão: tooling coberto por Vitest em tests/unit (sem Playwright)
Critério: CA-6 Perfil: time interno

Dado que o medidor OTel está ativo
Quando duas chamadas de tenants diferentes passam pela mesma tool
Então as métricas têm só os rótulos "tool" e "resultado"

## 9. Critérios de Aceitação

- **CA-1**: toda chamada de tool habilitada (ok) gera uma entrada com tool, tenant, resultado, latência e tokens estimados.
- **CA-2**: chamadas com erro (escopo, rate limit, validação, interno) geram entrada `error` com `code`.
- **CA-3**: tool inexistente ou com flag desligada não gera entrada.
- **CA-4**: falha ou lentidão do medidor nunca altera nem atrasa (acima do timeout) a resposta da tool.
- **CA-5**: com a flag desligada o `callTool` não mede e se comporta como hoje; a flag nasce desligada.
- **CA-6**: nenhuma entrada ou métrica contém payload, `actorId` ou tenant como rótulo OTel.
- **CA-7**: ADR-024, runbook de habilitação e SQL de referência da `mcp_uso_diario` entregues; CLAUDE.md/SKILLS.md/template-sync atualizados onde couber.

## 10. Itens Futuros

- Usuário final ver o próprio uso (tela/endpoint) e eventual cota por tenant.
- Alerta Grafana para tool com tokens médios acima de um teto.
- Gateway de saída para LLM, se um projeto derivado passar a chamar um modelo com chave própria.
- Tokenizer real no lugar da estimativa caracteres ÷ 4.

## Abordagens consideradas

- **A. Medidor no `callTool` (escolhida):** um ponto único, segue o padrão `IAuditLog`/`IRateLimiter`, OTel + tabela diária por tenant.
- **B. Só OTel/Grafana:** simples, mas sem histórico longo nem por tenant; não atende a auditoria.
- **C. Estender o `IAuditLog` com leituras:** mistura auditoria append-only de escritas com métrica e cresce uma linha por leitura.

## Decisões do builder (calls do Claudinho, revisáveis)

- Skeleton entrega interface + implementações em memória/OTel; `PostgresUsageMeter` é do projeto real (o skeleton não tem migrações, como `IAuditLog`).
- `@opentelemetry/api` como única dependência nova (no-op sem SDK).
- Tokens estimados = caracteres ÷ 4; ADR número 024 (023 é da Parte A).
- **Flag:** avaliada **a cada chamada** em `callTool` via `isEnabled(flag, deps.env ?? process.env)`, como as demais (kill switch em tempo de execução). Entrada em `FLAGS`: `observabilidade.uso-mcp`, env `USO_MCP_OBSERVABILIDADE`, `defaultOn: false`, sem `requires`. `CallToolDeps.usage` é obrigatório; a `composition.ts` sempre passa o medidor composto.
- **Latência:** cronômetro envolve o `execute()` inteiro (inclui escopo, rate limit e validação), então erros também têm latência.
- **Tokens:** só o `text` dos blocos de `content` (o `structuredContent` é o mesmo dado e não conta em dobro).
- **Registro:** `await` com `Promise.race` contra o timeout; o timeout vale para o medidor composto inteiro e é configurável em `CallToolDeps` (`usageTimeoutMs`, padrão 500) para o teste não esperar 500 ms reais. Sem `await` o registro seria cortado em serverless.
- **Composto:** `Promise.allSettled`; cada falha é logada individualmente e não impede os demais.
- **Tenant e código:** `tenantId = actor.tenantId` (inclui ator de sistema); `code` vem de `result._meta.code` com fallback `INTERNAL_ERROR`, como no `audit`. No rótulo OTel, código fora do conjunto conhecido de `AppError` vira `INTERNAL_ERROR` (cardinalidade fechada).
- **Skeleton:** o composto tem OTel + `InMemoryUsageMeter` com teto (10 000 entradas, descarta as mais antigas); `composition.ts` exporta `mcpUsageMeter` para testes de integração, como `mcpAuditLog`.
- **Entrega de documentação (CA-7):** ADR em `docs/adr/template/024-…`; runbook no formato do `check:runbooks` (Última verificação, classe R0–R3 por passo, `<preencher>` onde depende do projeto); novos arquivos listados no `template-sync.manifest.json`; testes de repositório (`check:runbooks`, `templateSyncSkill`, `check:cenarios`) passando.
