# AI-BOM e consumo de tokens (parte A) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** inventário de IA em CycloneDX (`npm run ai-bom`), telemetria de consumo do Claude Code e do
gate de CI no Grafana Cloud com alarme de teto, e histórico diário de auditoria no Neon.

**Architecture:** scripts `.mjs` na raiz (padrão de `scripts/deploy/`), puros e testáveis com I/O
injetado; um config versionado `ai-observabilidade.config.json` é o toggle e a fonte do teto; o
hub (`central: true`) gera alertas e roda o job diário; tudo fail-open.

**Tech Stack:** Node 20 ESM (`.mjs`), Vitest, GitHub Actions, Grafana Cloud (OTLP, Prometheus,
Loki, alerting), Neon via `@neondatabase/serverless` (driver HTTP, ADR-008), CycloneDX 1.6 JSON.

**Spec:** `docs/superpowers/specs/2026-11-27-ai-bom-consumo-tokens-design.md`

## Global Constraints

- Tooling da raiz **sem Zod** (ADR-007): validação à mão, mensagens `ai-observabilidade.config.json: <campo> …` (desvio consciente da spec §4.1, mesmo comportamento).
- Config ausente ou `"ativo": false` → telemetria, `--grafana` e job saem 0 com aviso; `npm run ai-bom` sempre funciona.
- Só `"central": true` gera alertas e roda o job diário.
- `projeto` do config é o ID canônico (OTEL local, OTEL CI, Neon, `porProjetoUsd`).
- Teto inicial `mensalUsd: 400`, `avisoPct: 80`.
- Nunca ler `.claude/settings.local.json`; nunca exportar prompt/resposta (`OTEL_LOG_USER_PROMPTS` ausente/0); nunca imprimir segredo.
- Nomes de variáveis OTEL e de métricas do Claude Code conferidos na doc oficial na Task 4 e centralizados em `scripts/ai-observabilidade/metricas.mjs` (nenhum outro arquivo repete o nome).
- Testes em `tests/unit/`, prefixo `aiBom*`/`aiObs*`; cada teste cita o `CT-AIBOM-NNN` no título.
- Commits `tipo(ai-bom): …` em português; tudo numa branch `feature/ai-bom-consumo-tokens`, só os arquivos deste plano (o working tree tem mudanças alheias — não as inclua).

## Review Focus

1. Derivado com config **sem** `central` mas com segredos do Grafana/Neon cadastrados → job diário e `--grafana` não tocam nada (Task 3 e 6 testam).
2. `.claude/settings.json` sem `enabledPlugins` ou sem `hooks`, skill sem frontmatter → inventário gera sem quebrar, omitindo o que falta (Task 2).
3. Workflow com `anthropics/*` sem SHA (tag `@v1`) → aparece no BOM com `version` da tag e sem hash, sem quebrar (Task 2).
4. `execution_file` truncado/JSON inválido → resumo do job diz "uso indisponível", gate não muda de veredito (Task 5).
5. Grafana sem dados do dia (resposta vazia) → job grava nada e sai 0; resposta com erro HTTP → sai 1 sem gravar parcial (Task 6).

---

### Task 1: Config `ai-observabilidade.config.json`

**Files:**

- Create: `scripts/ai-observabilidade/config.mjs`, `ai-observabilidade.config.json`
- Test: `tests/unit/aiObsConfig.test.ts`

**Interfaces:**

- Produces: `CONFIG_PATH = 'ai-observabilidade.config.json'`; `parseAiObsConfig(raw: unknown | null): AiObsConfig`; `readAiObsConfig(dir: string): AiObsConfig` onde `AiObsConfig = { ativo: boolean, projeto: string | null, central: boolean, teto: { mensalUsd: number, avisoPct: number, porProjetoUsd: Record<string, number> } }`; `papel(cfg): 'desligado' | 'emissor' | 'hub'`.

- [ ] **Step 1: testes** — `null` → `{ ativo:false, central:false, projeto:null, teto:{mensalUsd:400, avisoPct:80, porProjetoUsd:{}} }` e `papel` `'desligado'`; `{ativo:true, projeto:'ContasMes.ai'}` → `'emissor'`; `+central:true` → `'hub'`; `CT-AIBOM-005`: `mensalUsd: -10` lança `/teto.mensalUsd deve ser um número positivo/`; `avisoPct: 120` lança `/avisoPct deve estar entre 1 e 99/`; `ativo:true` sem `projeto` lança `/projeto deve ser um texto não vazio/`; `porProjetoUsd: { X: 0 }` lança.
- [ ] **Step 2:** `npx vitest run tests/unit/aiObsConfig.test.ts` → FAIL (módulo ausente).
- [ ] **Step 3:** implementar no estilo de `scripts/deploy/config.mjs` (`ehObjeto`, `erro`). Criar o `ai-observabilidade.config.json` do template: `{ "ativo": false, "projeto": "claude-clean-starter", "teto": { "mensalUsd": 400, "avisoPct": 80, "porProjetoUsd": {} } }`.
- [ ] **Step 4:** teste → PASS.
- [ ] **Step 5:** commit `feat(ai-bom): config de observabilidade de ia`.

### Task 2: Inventário CycloneDX e `--check`

**Files:**

- Create: `scripts/ai-bom/inventario.mjs`, `scripts/ai-bom.mjs` (CLI), `ai-bom.cdx.json` (gerado)
- Modify: `package.json` (`"ai-bom": "node scripts/ai-bom.mjs"`), `.github/workflows/ci.yml` (passo `Check AI-BOM` → `npm run ai-bom -- --check`, após `Check runbooks`)
- Test: `tests/unit/aiBomInventario.test.ts`, `tests/unit/aiBomCli.test.ts`

**Interfaces:**

- Consumes: `readAiObsConfig` (Task 1) — para `services` quando `ativo`.
- Produces: `coletar(fs: { readFile(p): string|null, list(dir): string[] }): Componentes`; `gerarBom(componentes, cfg): object` (CycloneDX); `serializar(bom): string` (JSON 2 espaços + `\n`); CLI `main(argv: string[], deps): Promise<number>` (exit code) com subcomandos `(nenhum)`, `--check`, `--env`, `--grafana` (os dois últimos nas Tasks 3 e 4).

- [ ] **Step 1: testes com fs em memória** — `CT-AIBOM-001`: fixture com 3 `enabledPlugins` true (+1 false), 2 `SKILL.md` com frontmatter, `hooks` com `SessionStart` (1) e `PreToolUse/Read` (1), `spec-gate.yml` com `anthropics/claude-code-action@925afb53776cf1a2b738c6bdbed37b4d4000ef13 # v1.0.262` e `SPEC_GATE_MODEL || 'claude-sonnet-5-5'` → `bom.bomFormat === 'CycloneDX'`, `specVersion === '1.6'`, componentes contêm os 3 plugins (o `false` não), 2 skills, 2 hooks (`name` = `"<evento>:<matcher>"`), a action com `version: 'v1.0.262'` e `hashes[0].content` = SHA, e `{ type: 'machine-learning-model', name: 'claude-sonnet-5-5' }`; `CT-AIBOM-003`: duas gerações → strings idênticas; `CT-AIBOM-004`: `settings.local.json` com `model` e plugin `pessoal@x` → nenhum dos dois no BOM; Review Focus 2 e 3 (settings sem chaves, skill sem frontmatter usa o nome da pasta, action `@v1` sem hash); `ativo:true` → `services` com `Anthropic API`, `Grafana Cloud`, `Neon`; `ativo:false` → só `Anthropic API` se houver action com IA.
- [ ] **Step 2: testes da CLI** — `CT-AIBOM-002`: arquivo existente divergente → exit 1, stderr contém `rode npm run ai-bom`; `CT-AIBOM-011`: arquivo ausente com `--check` → exit 0, stderr avisa; igual → exit 0.
- [ ] **Step 3:** FAIL.
- [ ] **Step 4:** implementar. `serialNumber` = `urn:uuid:` de um UUID v5-like derivado do SHA-256 do conteúdo sem o próprio `serialNumber`; `metadata` sem timestamp; componentes ordenados por `type`, `name`. Workflows lidos por regex sobre o texto (sem parser YAML — sem dependência nova).
- [ ] **Step 5:** PASS; `npm run ai-bom` gera `ai-bom.cdx.json`; `npm run ai-bom -- --check` → exit 0; tempo < 5 s.
- [ ] **Step 6:** commit `feat(ai-bom): inventario cyclonedx e check no ci`.

### Task 3: `--env` para a sessão local

**Files:**

- Modify: `scripts/ai-bom.mjs`
- Create: `scripts/ai-observabilidade/metricas.mjs`
- Test: `tests/unit/aiBomCli.test.ts`

**Interfaces:**

- Produces (`metricas.mjs`): `envTelemetria(projeto: string, origem: 'local'|'ci'): Record<string,string>` (sem endpoint/token); `METRICA_CUSTO`, `METRICA_TOKENS` (nomes Prometheus); `ATRIBUTO_PROJETO = 'projeto'`, `ATRIBUTO_ORIGEM = 'origem'`.

- [ ] **Step 1: testes** — `CT-AIBOM-010`: config `{ativo:true, projeto:'ContasMes.ai'}` → stdout tem `export CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_RESOURCE_ATTRIBUTES=projeto=ContasMes.ai,origem=local`, nenhuma linha com `OTEL_LOG_USER_PROMPTS=1`, e nenhum valor de `process.env.GRAFANA_OTLP_TOKEN` (setado no teste como `segredo-xyz`) aparece; endpoint e headers saem como `${GRAFANA_OTLP_ENDPOINT}`/`${GRAFANA_OTLP_HEADERS}` literais; `CT-AIBOM-006` parte: config desligado → exit 0, stdout vazio, stderr avisa.
- [ ] **Step 2:** FAIL. **Step 3:** conferir na doc oficial do Claude Code (Monitoring/OpenTelemetry) os nomes das variáveis (`OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_METRICS_INCLUDE_SESSION_ID` ou equivalente para tirar `session.id` das métricas) e das métricas; implementar `envTelemetria` e `--env`. Registrar a versão da doc consultada num comentário do `metricas.mjs`.
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(ai-bom): variaveis de telemetria por projeto`.

### Task 4: Painel e alertas do Grafana (`--grafana`)

**Files:**

- Create: `scripts/ai-observabilidade/grafana.mjs`, `observabilidade/grafana/painel.json`
- Modify: `scripts/ai-bom.mjs`
- Test: `tests/unit/aiObsGrafana.test.ts`

**Interfaces:**

- Consumes: `AiObsConfig`, `papel` (Task 1); `METRICA_CUSTO`, `ATRIBUTO_PROJETO` (Task 3).
- Produces: `regrasAlerta(cfg): object` (formato de provisioning de alert rules do Grafana, `apiVersion: 1`, um grupo `ai-teto`); CLI `--grafana` escreve em stdout.

- [ ] **Step 1: testes** — `CT-AIBOM-007`: teto 400 / aviso 80 → regra `teto-total-aviso` com threshold `320` e `teto-total-alarme` com `400`; `porProjetoUsd {'AssistBru.ai':100}` → regras `teto-AssistBru.ai-aviso` (80) e `-alarme` (100) com filtro `projeto="AssistBru.ai"`; `CT-AIBOM-006`: papel `emissor` ou `desligado` → `--grafana` exit 0, stdout vazio, stderr diz `só o hub (central: true) gera alertas`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar. Expressão da regra: `sum(increase(<METRICA_CUSTO>[30d]))` (com filtro `projeto` nas regras por projeto) — **janela móvel de 30 dias**, anotada na descrição da regra e no ADR-023 como aproximação do mês civil (PromQL não tem janela de mês civil); o mês civil exato fica na auditoria do Neon. `painel.json`: painéis custo×teto (total e por projeto), tokens por modelo/tipo, custo por origem/dia, sessões (Loki, `count_over_time`).
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(ai-bom): painel e alertas de teto no grafana`.

### Task 5: Uso do gate no resumo do job e OTEL no CI

**Files:**

- Modify: `scripts/spec-gate.mjs` (nova `resumoUso(executionJson: string|null): string`, chamada no `report` e escrita em `GITHUB_STEP_SUMMARY` se existir), `.github/workflows/spec-gate.yml`
- Test: `tests/unit/specGate.test.ts`

**Interfaces:**

- Consumes: `envTelemetria(projeto, 'ci')` (Task 3), `readAiObsConfig` (Task 1).

- [ ] **Step 1: testes** — `CT-AIBOM-009`: `execution_file` de exemplo (array de mensagens; a última `type: 'result'` com `usage.input_tokens: 12000`, `usage.output_tokens: 800`, `total_cost_usd: 0.051`) → resumo contém `12.000`, `800` e `US$ 0,051`; `null`/arquivo ausente → string vazia e `runReport` inalterado; Review Focus 4: JSON inválido → `uso indisponível`, veredito inalterado. Conferir o formato real do `execution_file` na versão fixada da action antes de fixar a fixture.
- [ ] **Step 2:** FAIL. **Step 3:** implementar; no workflow, passo `report` recebe `EXECUTION_FILE: ${{ steps.claude.outputs.execution_file }}`; passo novo antes da action: `node scripts/ai-bom.mjs --env-ci >> $GITHUB_ENV` só se `secrets.GRAFANA_OTLP_TOKEN != ''` (subcomando `--env-ci` = `envTelemetria(projeto,'ci')` + endpoint/headers vindos do env, sem `export`). Se a action não repassar env ao CLI, aplicar o fallback da spec §4.4 e registrar como `parcial`.
- [ ] **Step 4:** PASS (`specGate.test.ts` inteiro verde). **Step 5:** commit `feat(ai-bom): uso de tokens do spec-gate no resumo e otel no ci`.

### Task 6: Resumo diário no Neon

**Files:**

- Create: `scripts/ai-observabilidade/consumoDiario.mjs`, `observabilidade/neon/001-consumo-diario.sql`, `.github/workflows/ai-consumo-diario.yml`
- Modify: `package.json` (devDependency `@neondatabase/serverless`, mesma major do `examples/walking-skeleton` se houver; script `"ai-obs:consumo-diario"`)
- Test: `tests/unit/aiObsConsumoDiario.test.ts`

**Interfaces:**

- Consumes: `readAiObsConfig`, `papel` (Task 1); `METRICA_CUSTO`, `METRICA_TOKENS`, atributos (Task 3).
- Produces: `coletarDia({ dia: string, consultar: (promql: string) => Promise<Serie[]>, contarSessoes: (logql: string) => Promise<Record<string, number>> }): Promise<Linha[]>`; `gravar(sql: TaggedSql, linhas: Linha[]): Promise<void>` (`insert … on conflict (dia, projeto, origem, modelo) do update`); `main({ env, cfg, fetch, sql, hoje }): Promise<number>`.

- [ ] **Step 1: testes** — `CT-AIBOM-008`: fake `consultar` devolve custo 1.5 e tokens de `AssistBru.ai`/`local`/`claude-opus-5-5` para `dia = '2026-11-26'` (dia anterior a `hoje = 2026-11-27T03:00Z`); `sql` fake em memória com a chave primária da migração; rodar `main` duas vezes → 1 linha, `custo_usd 1.5`; `CT-AIBOM-006`: papel `emissor` com `GRAFANA_READ_TOKEN` e `AI_OBS_DATABASE_URL` setados → exit 0, `fetch` e `sql` nunca chamados; Review Focus 5: séries vazias → nenhuma escrita, exit 0; `consultar` rejeita (HTTP 500) → exit 1 e nenhuma escrita.
- [ ] **Step 2:** FAIL. **Step 3:** implementar; migração = DDL da spec §6 literal; workflow: `schedule: cron '30 3 * * *'` + `workflow_dispatch`, `permissions: contents: read`, `env` com os 3 secrets (`GRAFANA_API_URL`, `GRAFANA_READ_TOKEN`, `AI_OBS_DATABASE_URL`), passo único `npm ci && npm run ai-obs:consumo-diario`.
- [ ] **Step 4:** PASS; `npm run lint && npm run type-check`. **Step 5:** commit `feat(ai-bom): resumo diario de consumo no neon`.

### Task 7: ADR-023, runbook, sync e ponteiros

**Files:**

- Create: `docs/adr/template/023-ai-bom-e-observabilidade-de-consumo.md`, `docs/runbooks/ai-observabilidade-habilitar.md`
- Modify: `docs/runbooks/README.md` (linha no catálogo), `template-sync.manifest.json` (`ai-bom.cdx.json` em `ignore`; novos testes `tests/unit/aiBom*.test.ts`/`aiObs*.test.ts` em `managed`), `.claude/skills/template-sync/SKILL.md` (semear `ai-observabilidade.config.json` junto de `docs/rnf.md`/`auth.setup.ts`, sem sobrescrever, e passo "rode `npm run ai-bom` e commite"), `tests/unit/templateSyncSkill.test.ts` (`SEMEADOS` + o novo arquivo), `CLAUDE.md` (bloco **Adoção — consumo de IA** com 2 linhas, ADR-023), `SKILLS.md` (uma linha sob Transversais apontando o runbook)
- Test: `npm run check:runbooks`, `tests/unit/templateSyncSkill.test.ts`, `tests/unit/docsLinks.test.ts`

- [ ] **Step 1:** atualizar `SEMEADOS` no teste → FAIL.
- [ ] **Step 2:** escrever ADR-023 (contexto = spec §1; decisão = abordagem 1 + hub único + janela móvel de 30 d no alerta / mês civil no Neon + sem Zod pelo ADR-007; alternativas = spec §3). Runbook a partir de `_TEMPLATE.md` com seções: Grafana Cloud (stack, token OTLP, contato e-mail) `[R2]`; variáveis pessoais via `npm run ai-bom -- --env` `[R1]`; secrets do CI `[R2]`; Neon `ai-observabilidade` + migração pelo padrão ADR-008 `[R2]`; import do `painel.json` e das regras do `--grafana` `[R1]`; ligar `ativo`/`central` no hub `[R1]`; Verificação final = custo de uma sessão visível em ≤ 5 min e 1 linha em `consumo_diario` após `workflow_dispatch`. Segredos digitados pelo humano fora da sessão (como `bunny-habilitar.md`).
- [ ] **Step 3:** editar skill, manifesto, `CLAUDE.md`, `SKILLS.md`.
- [ ] **Step 4:** `npm test && npm run lint && npm run type-check && npm run check:runbooks && npx prettier --check .` → tudo verde (CA-6, CA-7).
- [ ] **Step 5:** commit `docs(ai-bom): adr-023, runbook e sync`.

---

## Encerramento (sessão principal, não subagente)

`superpowers:verification-before-completion` → conferência spec × código no template de PR
(CA-3 e a ativação real ficam `parcial` até o runbook rodar) → regra 5 (conta `schiozer`) → push
da branch → PR com base `main`, UAT desmarcado.
