# Medição de uso das tools MCP — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir cada chamada de tool MCP (tool, tenant, resultado, latência, tokens estimados da resposta) atrás da flag `observabilidade.uso-mcp`, com OTel e um ponto de extensão para a tabela diária no Neon.

**Architecture:** Um `IUsageMeter` injetado em `CallToolDeps`, no mesmo molde de `IAuditLog`/`IRateLimiter`. O `callTool` cronometra o `execute()` inteiro e registra com `await` + timeout; falha do medidor é logada e nunca afeta a tool. Skeleton entrega medidores nulo, em memória (com teto), OTel e composto; o medidor Postgres é do projeto real, com SQL de referência no runbook.

**Tech Stack:** TypeScript, Vitest, `@opentelemetry/api` (única dependência nova), Next.js skeleton em `examples/walking-skeleton`.

**Spec:** `docs/superpowers/specs/2026-11-28-uso-mcp-observabilidade-design.md`

## Global Constraints

- Tudo do código fica em `examples/walking-skeleton/` (`src/shared/mcp/`, `src/composition.ts`, `tests/unit/`, `tests/integration/`); sem `any`, sem `console.*` (use `logError`), imports via alias `@/`.
- `UsageEntry = { at: string; tenantId: string; tool: string; outcome: 'ok' | 'error'; code?: string; latencyMs: number; outputTokensEst: number }`. **Nunca** args, conteúdo da resposta nem `actorId`.
- `estimateTokens(text) = Math.ceil(text.length / 4)`; conta só o `text` dos blocos `content` (nunca `structuredContent`).
- Flag `observabilidade.uso-mcp`, env `USO_MCP_OBSERVABILIDADE`, `defaultOn: false`, sem `requires`; avaliada **a cada chamada** com `isEnabled(flag, deps.env ?? process.env)`.
- Tool inexistente ou com flag da tool desligada (`NOT_FOUND`) **não é medida**. Escopo negado, rate limit, validação e erro interno **são medidos**, com `code` = `result._meta.code` (fallback `INTERNAL_ERROR`).
- Timeout do registro: `usageTimeoutMs` em `CallToolDeps`, opcional, padrão `500`; vale para o medidor composto inteiro.
- Métricas OTel: `mcp_tool_calls_total{tool,resultado}`, histogramas `mcp_tool_output_tokens_est{tool}` e `mcp_tool_duration_ms{tool}`. Rótulos só `tool` e `resultado`; **tenant nunca é rótulo**; código desconhecido vira `INTERNAL_ERROR` no rótulo.
- `InMemoryUsageMeter` guarda no máximo 10 000 entradas (descarta as mais antigas).
- Commits: `tipo(escopo): mensagem` em português, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Nunca merge/push na `main`; trabalho na branch `feature/uso-mcp-observabilidade`.
- Rodar sempre de `examples/walking-skeleton`: `npm test`, `npm run type-check`, `npm run lint`.

## Review Focus

- Medidor que lança **de forma síncrona** (não só rejeita a promise) não pode quebrar a tool.
- Timeout que estoura deixa a promise do medidor pendente: ela não pode virar `unhandledRejection` ao rejeitar depois.
- Resposta com bloco de `content` que não é `text` (imagem etc.): tokens contam só os blocos `text`, sem lançar.
- Resposta enorme (centenas de milhares de caracteres): estimativa correta, sem erro.
- Dois tenants na mesma tool: métricas OTel idênticas em rótulos (sem tenant) e entradas distintas no medidor.
- Ator de sistema (`via: 'system'`): `tenantId` do ator é registrado normalmente.

---

### Task 1: Tipos e medidores base (`usage.ts`)

**Files:**
- Create: `examples/walking-skeleton/src/shared/mcp/usage.ts`
- Test: `examples/walking-skeleton/tests/unit/usage.test.ts`

**Interfaces:**
- Produces:
  - `interface UsageEntry` (campos nas Global Constraints)
  - `interface IUsageMeter { record(entry: UsageEntry): Promise<void> }`
  - `estimateTokens(text: string): number`
  - `class NullUsageMeter implements IUsageMeter`
  - `class InMemoryUsageMeter implements IUsageMeter` — `constructor(maxEntries = 10_000)`, `get entries(): readonly UsageEntry[]`, `clear(): void`
  - `class CompositeUsageMeter implements IUsageMeter` — `constructor(meters: readonly IUsageMeter[])`; `Promise.allSettled`, cada falha logada com `logError('mcp:usage', error)`, nunca rejeita

- [ ] **Step 1: Write the failing tests** em `usage.test.ts`:
  - `estimateTokens('')` = 0, `'abcd'` = 1, `'abcde'` = 2.
  - `InMemoryUsageMeter(2)` com 3 `record` mantém só as 2 últimas, na ordem.
  - `NullUsageMeter.record` resolve sem efeito.
  - `CompositeUsageMeter` com um medidor que rejeita e outro em memória: o em memória recebe a entrada, `record` resolve, `logError` foi chamado (spy via `vi.mock('@/shared/logError')`).
  - Composto com medidor que lança **sincronamente** em `record` também não rejeita e os demais recebem a entrada.
- [ ] **Step 2: Run** `npx vitest run tests/unit/usage.test.ts` — Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement** `usage.ts` conforme Interfaces. Envolva a chamada de cada medidor em `async () => meter.record(entry)` para capturar throw síncrono dentro do `allSettled`.
- [ ] **Step 4: Run** o mesmo teste — Expected: PASS. Rodar também `npm run type-check`.
- [ ] **Step 5: Export** `IUsageMeter`, `UsageEntry`, `NullUsageMeter`, `InMemoryUsageMeter`, `CompositeUsageMeter`, `estimateTokens` em `shared/mcp/index.ts`.
- [ ] **Step 6: Commit** `feat(mcp): medidores de uso base (nulo, memória, composto)`.

---

### Task 2: Flag e integração no `callTool` (CT-MCPU-001..007)

**Files:**
- Modify: `examples/walking-skeleton/src/shared/featureFlags.ts` (nova entrada em `FLAGS`)
- Modify: `examples/walking-skeleton/src/shared/mcp/callTool.ts`
- Modify: `examples/walking-skeleton/src/shared/mcp/server.ts` (`McpHandlerDeps.usage: IUsageMeter`, repassa ao `callTool`)
- Modify: `examples/walking-skeleton/src/composition.ts` (passa `usage` provisório: `new NullUsageMeter()`; a Task 3 troca pelo composto)
- Modify: `examples/walking-skeleton/tests/unit/callTool.test.ts`, `mcpServer.test.ts` e outros que montem `CallToolDeps`/`McpHandlerDeps` (adicionar `usage: new NullUsageMeter()`)
- Test: `examples/walking-skeleton/tests/unit/callToolUsage.test.ts`, caso novo em `featureFlags.test.ts`

**Interfaces:**
- Consumes: `IUsageMeter`, `UsageEntry`, `estimateTokens` (Task 1).
- Produces: `CallToolDeps` ganha `usage: IUsageMeter` (obrigatório) e `usageTimeoutMs?: number`. `FlagName` inclui `'observabilidade.uso-mcp'`.

- [ ] **Step 1: Write the failing tests.** Em `featureFlags.test.ts`: `isEnabled('observabilidade.uso-mcp', {})` = false; `{ USO_MCP_OBSERVABILIDADE: 'on' }` = true; independe de `RESOURCES_ENABLED`. Em `callToolUsage.test.ts` (reusar tools/atores do `callTool.test.ts`; `env` com a flag `on`), um teste por cenário:
  - **CT-MCPU-001** sucesso → `InMemoryUsageMeter.entries` tem 1 entrada com `tool: 'list_things'`, `tenantId: 't1'`, `outcome: 'ok'`, `latencyMs >= 0`, `outputTokensEst === estimateTokens(result.content[0].text)`; o resultado é igual ao de uma chamada com a flag desligada.
  - **CT-MCPU-002** ator sem escopo → entrada `outcome: 'error'`, `code: 'FORBIDDEN'` (confirme o código real em `shared/errors.ts`).
  - **CT-MCPU-003** tool inexistente → 0 entradas.
  - **CT-MCPU-004** medidor que rejeita **e** medidor que lança sincronamente → resultado normal; `logError` chamado.
  - **CT-MCPU-005** medidor que nunca resolve, `usageTimeoutMs: 20` → `callTool` resolve em < 200 ms (fake timers ou medição real); depois do timeout, rejeitar a promise pendente não gera `unhandledRejection`.
  - **CT-MCPU-006** flag desligada → medidor espião com 0 chamadas; resultado idêntico.
  - **CT-MCPU-007** entrada registrada, serializada com `JSON.stringify`, não contém o argumento enviado, o texto da resposta nem `ana` (id do ator).
  - Foco de revisão: resposta com bloco não-`text` não lança e conta só os `text`; resposta de 400 000 caracteres → `outputTokensEst === 100000`; ator `via: 'system'` registra o `tenantId` dele; rate limit estourado → entrada `error` com `code: 'RATE_LIMITED'` (confirme o código).
- [ ] **Step 2: Run** `npx vitest run tests/unit/callToolUsage.test.ts tests/unit/featureFlags.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Flag em `FLAGS`. Em `callTool`: depois de resolver a tool habilitada, marcar `t0` com `(deps.clock ?? systemClock).now()` (ou `performance.now()` — escolha o que o `Clock` suportar sem quebrar `fixedClock`), executar `execute()`, e, se a flag estiver ligada, chamar uma função `recordUsage(tool, actor, result, latencyMs, deps)` que monta a `UsageEntry` (`code` só quando `isError`, lido de `_meta.code`), e faz `await Promise.race([Promise.resolve().then(() => deps.usage.record(entry)), timeout])` dentro de `try/catch` com `logError('mcp:usage', …)`. Anexe `.catch(() => {})` à promise do medidor para absorver rejeição tardia. Limpe o `setTimeout` do timeout no `finally`. Tokens: somar `estimateTokens` só dos blocos com `type === 'text'`.
- [ ] **Step 4: Atualizar** `server.ts`, `composition.ts` e os testes existentes para passar `usage`.
- [ ] **Step 5: Run** `npm test && npm run type-check && npm run lint` — Expected: tudo PASS.
- [ ] **Step 6: Commit** `feat(mcp): mede o uso das tools no callTool atrás da flag observabilidade.uso-mcp`.

---

### Task 3: Medidor OTel e wiring (CT-MCPU-008)

**Files:**
- Create: `examples/walking-skeleton/src/shared/mcp/otelUsageMeter.ts`
- Modify: `examples/walking-skeleton/package.json` e lockfile (`npm install @opentelemetry/api`)
- Modify: `examples/walking-skeleton/src/composition.ts` (exporta `mcpUsageMeter`; passa-o ao handler)
- Modify: `examples/walking-skeleton/src/shared/mcp/index.ts`
- Test: `examples/walking-skeleton/tests/unit/otelUsageMeter.test.ts`, caso novo em `tests/integration/mcp.route.test.ts`

**Interfaces:**
- Consumes: `IUsageMeter`, `UsageEntry`, `CompositeUsageMeter`, `InMemoryUsageMeter` (Task 1).
- Produces: `class OtelUsageMeter implements IUsageMeter` — `constructor(meter: Meter = metrics.getMeter('mcp'))`, cria o contador e os dois histogramas das Global Constraints. `composition.ts` exporta `mcpUsageMeterMemory: InMemoryUsageMeter` e `mcpUsageMeter: IUsageMeter` (composto OTel + memória).

- [ ] **Step 1: Write the failing tests.** `otelUsageMeter.test.ts` com `Meter` falso que captura `add`/`record` e os atributos:
  - **CT-MCPU-008** duas entradas de tenants diferentes na mesma tool → atributos de ambas são exatamente `{ tool, resultado }` (sem chave de tenant) e iguais entre si.
  - `outcome: 'ok'` → `resultado: 'ok'`; erro com `code: 'FORBIDDEN'` → `resultado: 'FORBIDDEN'`; `code: 'CODIGO_INVENTADO'` → `resultado: 'INTERNAL_ERROR'` (conjunto conhecido derivado das subclasses de `AppError` em `shared/errors.ts`, mais `VALIDATION_ERROR` e `INTERNAL_ERROR`).
  - Histogramas recebem `outputTokensEst` e `latencyMs`.
  - Integração: chamada real em `/api/mcp` com `USO_MCP_OBSERVABILIDADE=on` deixa 1 entrada em `mcpUsageMeterMemory.entries`; com a flag desligada, 0 (limpar o medidor em `beforeEach`, como `mcpAuditLog.clear()`).
- [ ] **Step 2: Run** os testes — Expected: FAIL.
- [ ] **Step 3: Implement** `OtelUsageMeter` e o wiring em `composition.ts`.
- [ ] **Step 4: Run** `npm test && npm run type-check && npm run lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcp): medidor OTel e wiring do uso das tools`.

---

### Task 4: ADR-024, runbook e documentação (CA-7)

**Files:**
- Create: `docs/adr/template/024-medicao-de-uso-das-tools-mcp.md` (base: `docs/adr/000-template.md`; contexto: usuário paga os tokens; decisão A; alternativas B e C; consequências; relação com ADR-010/012 e com a Parte A/ADR-023 apenas por menção)
- Create: `docs/runbooks/uso-mcp-habilitar.md` (base: `docs/runbooks/_TEMPLATE.md`)
- Modify: `docs/runbooks/README.md` (linha na tabela), `docs/superpowers/specs/2026-11-28-uso-mcp-observabilidade-design.md` (Status → `Aprovada`)
- Modify: `CLAUDE.md` e `SKILLS.md` **somente** se houver lista onde o item caiba (uma linha de "Adoção — uso MCP" apontando o runbook); não reestruture.

**Interfaces:**
- Consumes: nomes de flag, env, métricas e esquema SQL das Global Constraints e do §6 da spec.
- Produces: runbook com passos classificados `[R0]`–`[R3]` e `Verificar:`: (1) `[R1]` criar `mcp_uso_diario` no Neon do ambiente (SQL do §6, com o upsert por chamada como exemplo de `PostgresUsageMeter` a implementar no projeto), (2) `[R1]` configurar o endpoint OTLP e registrar o SDK no projeto (`<preencher: …>`), (3) `[R2]` ligar `USO_MCP_OBSERVABILIDADE=on` em Prod (R1 fora de Prod) via `feature-flags.md`, (4) `[R0]` verificar métricas no Grafana e consultas SQL de exemplo (tokens por tool e por tenant no mês), (5) rollback = desligar a flag.

- [ ] **Step 1: Escrever** ADR, runbook e entradas de índice.
- [ ] **Step 2: Run** `npm run check:runbooks` e `npx vitest run tests/unit/checkRunbooks.test.ts tests/unit/docsLinks.test.ts tests/unit/templateSyncSkill.test.ts` (na raiz do repo) — Expected: PASS. O manifest já cobre `docs/adr/template/**`, `docs/runbooks/**` e `examples/**`: confirmar que nenhum arquivo novo fica de fora, sem editar o manifest.
- [ ] **Step 3: Run** `npm run check:cenarios` na raiz — Expected: PASS (os CT-MCPU estão `Fora da regressão`).
- [ ] **Step 4: Commit** `docs(adr): ADR-024 e runbook de medição de uso das tools MCP`.

---

### Task 5: Verificação final

- [ ] **Step 1:** Em `examples/walking-skeleton`: `npm test && npm run type-check && npm run lint`; na raiz: `npm test`, `npm run check:runbooks`, `npm run check:cenarios`. Tudo deve passar.
- [ ] **Step 2:** Conferência spec × código (CA-1..CA-7, tabela `ok`/`parcial`/`fora`) para o template de PR; `git status` limpo e só arquivos desta feature na branch.
