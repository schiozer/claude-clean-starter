# Runbook: Habilitar a medição de uso das tools MCP

**Responsável**: <preencher: pessoa/time>
**Última verificação**: 2026-11-28
**Ambientes**: Dev, UAT, Prod

## Objetivo

Ligar a medição de uso das tools MCP ([ADR-024](../adr/template/024-medicao-de-uso-das-tools-mcp.md)):
métricas por tool no Grafana (OTel) e a tabela diária por tenant no Neon. A flag
`observabilidade.uso-mcp` nasce **desligada**; este runbook cria o destino dos dados antes de ligá-la.

## Pré-condições

- Ambientes criados ([bootstrap-ambientes.md](./bootstrap-ambientes.md)) e MCP habilitado ([mcp-habilitar-e-conectar.md](./mcp-habilitar-e-conectar.md)).
- Endpoint OTLP do Grafana Cloud do projeto: `<preencher: endpoint OTLP>`.
- O projeto implementou o `PostgresUsageMeter` (upsert abaixo) e o somou ao `CompositeUsageMeter` em `composition.ts`; o SDK OTel está registrado no app (`@opentelemetry/sdk-node` ou o do host) **antes da primeira chamada de tool** (ex.: `instrumentation.ts`); sem MeterProvider nesse momento as métricas ficam no-op e nada aparece no Grafana.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir a conta e o projeto do host: Pre-flight do runbook do host do `deploy.config.json` (host-<host>.md).
3. [R0] Conferir o projeto/branch Neon do ambiente-alvo: `<preencher: projeto/branch Neon>`.

## Passos

1. [R1] Criar a tabela no Neon do ambiente (fora de Prod; em Prod é **R2**), via [migracao-banco.md](./migracao-banco.md):

   ```sql
   CREATE TABLE IF NOT EXISTS mcp_uso_diario (
     dia date NOT NULL, tenant_id text NOT NULL, tool text NOT NULL,
     chamadas int NOT NULL DEFAULT 0, erros int NOT NULL DEFAULT 0,
     tokens_saida_est bigint NOT NULL DEFAULT 0, duracao_ms_total bigint NOT NULL DEFAULT 0,
     PRIMARY KEY (dia, tenant_id, tool)
   );
   ```

   Verificar: `SELECT count(*) FROM mcp_uso_diario;` → `0`.

   Referência do `PostgresUsageMeter` (uma chamada por registro, `at::date` em UTC):

   ```sql
   INSERT INTO mcp_uso_diario (dia, tenant_id, tool, chamadas, erros, tokens_saida_est, duracao_ms_total)
   VALUES ($1, $2, $3, 1, $4, $5, $6)
   ON CONFLICT (dia, tenant_id, tool) DO UPDATE SET
     chamadas = mcp_uso_diario.chamadas + 1,
     erros = mcp_uso_diario.erros + EXCLUDED.erros,
     tokens_saida_est = mcp_uso_diario.tokens_saida_est + EXCLUDED.tokens_saida_est,
     duracao_ms_total = mcp_uso_diario.duracao_ms_total + EXCLUDED.duracao_ms_total;
   ```

2. [R1] Definir as envs OTLP do ambiente (endpoint e headers, segredo no host) via [segredos-e-env.md](./segredos-e-env.md); em Prod é **R2**.
   Verificar: a listagem de nomes do bloco **Segredos e envs** do runbook do host mostra os nomes no ambiente.
3. [R1] Ligar `USO_MCP_OBSERVABILIDADE=on` no ambiente via [feature-flags.md](./feature-flags.md); em Prod é **R2**.
   Verificar: a listagem de nomes de envs do ambiente mostra `USO_MCP_OBSERVABILIDADE`.
4. [R0] Fazer uma chamada de tool com um PAT de teste e conferir os dados.
   Verificar: no Grafana, `mcp_tool_calls_total{tool="<tool>"}` aparece; no Neon, `SELECT tool, chamadas, tokens_saida_est FROM mcp_uso_diario WHERE dia = current_date;` traz a linha do tenant de teste.

## Verificação final

- Tokens estimados por tool no mês: `SELECT tool, sum(tokens_saida_est) FROM mcp_uso_diario WHERE dia >= date_trunc('month', current_date) GROUP BY tool ORDER BY 2 DESC;`
- Uso por tenant (auditoria): mesma consulta com `GROUP BY tenant_id`.
- Nenhuma métrica tem rótulo de tenant; nenhuma linha carrega argumentos ou conteúdo.

## Rollback

1. [R1] Desligar a flag (`USO_MCP_OBSERVABILIDADE=off`) via [feature-flags.md](./feature-flags.md); em Prod é **R2**.
   Verificar: novas chamadas deixam de aparecer no Grafana e no Neon.
2. [R2] Só se for descartar o histórico: `DROP TABLE mcp_uso_diario;` — destrutivo, pedir aprovação.
   Verificar: `SELECT to_regclass('mcp_uso_diario');` → `NULL`.

## Registro

Comentário no PR relacionado (`gh pr comment <n> --body-file <arquivo>`) ou issue `ops`. Sem segredos.
