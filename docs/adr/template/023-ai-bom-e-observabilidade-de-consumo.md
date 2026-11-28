# 023. AI-BOM e observabilidade de consumo de IA no desenvolvimento

**Data**: 2026-11-27
**Status**: Aceito

## Contexto

O [ADR-022](./022-politica-de-modelo-esforco-e-tokens.md) diz **como** gastar menos tokens, mas o
template não **mede** o consumo nem lista os componentes de IA que o projeto usa. Os projetos
passam a rodar sob limites de token e o mantenedor quer controlar o gasto (ser alarmado antes de
estourar um teto mensal), ter indicadores de auditoria (histórico por projeto, modelo e origem, e
um inventário dos componentes de IA) e aprender a stack de mercado de observabilidade de IA
(OpenTelemetry + Grafana), que a parte B (consumo de LLM pelo produto) reaproveitará.

O escopo é o consumo de quem **constrói**: sessões do Claude Code (principal e subagentes) e o
gate Spec × código no CI, no template e nos derivados, que recebem tudo pelo `/template-sync`.
Spec: [`2026-11-27-ai-bom-consumo-tokens-design.md`](../../superpowers/specs/2026-11-27-ai-bom-consumo-tokens-design.md).

## Decisão

1. **Grafana Cloud no dia a dia + resumo diário no Neon para auditoria.** Claude Code e CI exportam
   OTLP direto para o Grafana Cloud (free tier); painel e alertas ficam lá
   (`observabilidade/grafana/`); um job diário grava o consumo do dia anterior em `consumo_diario`
   no Neon (`observabilidade/neon/`, migração pelo padrão do
   [ADR-008](./008-migracoes-sql-versionadas-driver-http.md)), que guarda o histórico além da
   retenção curta do free tier.
2. **AI-BOM**: `npm run ai-bom` gera `ai-bom.cdx.json` (CycloneDX), determinístico; `--check`
   barra no CI o inventário desatualizado. `ai-bom.cdx.json` é do projeto (`ignore` do manifesto).
3. **Hub único e emissores.** `ai-observabilidade.config.json` é por projeto (semeado pelo sync sem
   sobrescrever; `ignore` do manifesto) e nasce com `ativo: false`. Papéis: desligado, emissor
   (`ativo`) e hub (`ativo` + `central: true`). **Só o hub** gera as regras de alerta
   (`npm run ai-bom -- --grafana`) e roda o job diário `ai-consumo-diario.yml`; nos demais ele sai 0.
4. **Janela do alerta**: janela móvel de 30 dias,
   `sum(increase(claude_code_cost_usage_USD_total[30d]))`. O PromQL não tem janela de mês civil,
   então ela aproxima o mês; o mês civil exato fica na tabela de auditoria do Neon. Os limiares
   (`mensalUsd`, `avisoPct`, `porProjetoUsd`) vêm do config, fonte única do teto.
5. **Sessões pela métrica**, não pelo Loki: `claude_code.session.count` (Prometheus
   `claude_code_session_count_total`). Definimos `OTEL_METRICS_INCLUDE_SESSION_ID=false` para não
   explodir a cardinalidade do free tier, e isso também remove `session.id` dos eventos, o que
   inviabiliza contar sessões por eventos no Loki (desvio da §4.5 da spec, com a mesma intenção).
   Logs e eventos continuam saindo por OTLP. No Neon, as sessões do dia ficam numa linha com
   `modelo='*'`, tokens e custo zerados.
6. **Segredos do CI**: `GRAFANA_OTLP_ENDPOINT` e `GRAFANA_OTLP_HEADERS` (o valor completo do
   header, `Authorization=Basic <base64>`), no lugar de um `GRAFANA_OTLP_TOKEN`, porque o
   `$GITHUB_ENV` não expande `${}`. No `spec-gate.yml` a action recebe
   `settings: {"env":{"OTEL_METRICS_INCLUDE_SESSION_ID":"false"}}`. O job diário usa
   `GRAFANA_API_URL`, `GRAFANA_READ_TOKEN` e `AI_OBS_DATABASE_URL`. A credencial OTLP do CI é
   **só de ingestão** (escrita de métricas e logs): os scripts do gate rodam do head do PR; a de
   leitura é outra credencial, só para o job diário.
7. **Fail-open em tudo**: falha de telemetria ou do Grafana nunca bloqueia a sessão nem o gate de
   CI. O job diário sai 1 em falha, sem gravação parcial (um único `INSERT … ON CONFLICT`, idempotente).
8. **Sem Zod**: o tooling da raiz valida o config à mão, pelo [ADR-007](./007-tooling-da-raiz-isolado-de-exemplos.md).
9. **Privacidade**: prompts e respostas nunca são exportados (`OTEL_LOG_USER_PROMPTS` ausente);
   segredos nunca entram no repositório nem na sessão do agente (runbook, ADR-013 §4).

O passo a passo está no runbook [`ai-observabilidade-habilitar.md`](../../runbooks/ai-observabilidade-habilitar.md).

## Consequências

- Custo visível em minutos, alarme antes do teto e histórico durável por projeto, modelo e origem.
- O alerta é uma aproximação (janela de 30 dias); o número contábil do mês é o do Neon.
- Os nomes das métricas no Prometheus dependem da versão do Claude Code e do Grafana Cloud: ficam
  todos em `scripts/ai-observabilidade/metricas.mjs`, e o runbook manda conferi-los no Explore.
- O hub concentra credenciais e o projeto Neon; derivados só emitem.
- Quem não liga a feature (`ativo: false`) não muda nada; o sync e o CI seguem como antes.

## Alternativas Consideradas

- **Neon como fonte única** com receptor OTLP nosso e Grafana local: uma fonte só, mas código nosso
  para manter e Grafana local para subir.
- **Relatório local lendo os `.jsonl` do Claude Code**: zero infraestrutura, mas sem alarme ativo,
  sem CI centralizado e menos aprendizado.
- **Stack local `otel-lgtm` + cópia no Neon**: dois armazenamentos e o CI fica de fora.
- **Hook de fim de sessão gravando no git**: dado pessoal no repositório, ruído de commit e
  conflito com o ADR-022.
- **Sessões por Loki (spec §4.5)**: exigiria `session.id` nos eventos, que desligamos por cardinalidade.
