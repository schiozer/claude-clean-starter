import { metrics, type Counter, type Histogram, type Meter } from '@opentelemetry/api'
import type { IUsageMeter, UsageEntry } from './usage'

/** Códigos de `AppError` + os de borda. Fora daqui o rótulo vira INTERNAL_ERROR (cardinalidade fechada). */
const KNOWN_CODES = new Set([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'TIMEOUT',
  'INTERNAL_ERROR',
])

const resultLabel = (entry: UsageEntry): string => {
  if (entry.outcome === 'ok') return 'ok'
  return entry.code && KNOWN_CODES.has(entry.code) ? entry.code : 'INTERNAL_ERROR'
}

/**
 * Métricas por tool. O tenant NUNCA vira rótulo (cardinalidade e privacidade): ele só existe na
 * tabela diária do Neon. Sem SDK registrado, o meter padrão do `@opentelemetry/api` é no-op.
 */
export class OtelUsageMeter implements IUsageMeter {
  private readonly calls: Counter
  private readonly outputTokens: Histogram
  private readonly duration: Histogram

  constructor(meter: Meter = metrics.getMeter('mcp')) {
    this.calls = meter.createCounter('mcp_tool_calls_total', { description: 'Chamadas de tool MCP' })
    this.outputTokens = meter.createHistogram('mcp_tool_output_tokens_est', {
      description: 'Tokens estimados (caracteres ÷ 4) da resposta da tool',
    })
    this.duration = meter.createHistogram('mcp_tool_duration_ms', { unit: 'ms' })
  }

  async record(entry: UsageEntry): Promise<void> {
    this.calls.add(1, { tool: entry.tool, resultado: resultLabel(entry) })
    this.outputTokens.record(entry.outputTokensEst, { tool: entry.tool })
    this.duration.record(entry.latencyMs, { tool: entry.tool })
  }
}
