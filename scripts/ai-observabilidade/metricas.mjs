// Única fonte dos nomes de variáveis OTEL e de métricas do Claude Code (nenhum outro arquivo os repete).
// Conferido em 2026-11-27 na doc oficial: https://code.claude.com/docs/en/monitoring-usage
// (docs.anthropic.com/en/docs/claude-code/monitoring-usage redireciona para lá).
// Métricas OTel: claude_code.cost.usage (USD) e claude_code.token.usage (tokens). No Prometheus/Grafana
// Cloud o ponto vira "_" e entram unidade e sufixo de counter.

export const METRICA_CUSTO = 'claude_code_cost_usage_USD_total'
export const METRICA_TOKENS = 'claude_code_token_usage_tokens_total'

export const ATRIBUTO_PROJETO = 'projeto'
export const ATRIBUTO_ORIGEM = 'origem'

/**
 * Variáveis que ligam a telemetria do Claude Code. Sem endpoint e sem token (segredos ficam fora).
 * Prompts e respostas nunca são exportados: OTEL_LOG_USER_PROMPTS fica ausente.
 * @param {string} projeto
 * @param {'local' | 'ci'} origem
 * @returns {Record<string, string>}
 */
export function envTelemetria(projeto, origem) {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_METRICS_INCLUDE_SESSION_ID: 'false',
    OTEL_RESOURCE_ATTRIBUTES: `${ATRIBUTO_PROJETO}=${projeto},${ATRIBUTO_ORIGEM}=${origem}`,
  }
}
