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
 *
 * Os instrumentos são criados no primeiro `record`, não no import: `metrics.getMeter()` devolve um
 * meter no-op definitivo se o MeterProvider ainda não estiver registrado. Registre o SDK (ex.:
 * `instrumentation.ts`) antes da primeira chamada de tool.
 */
export class OtelUsageMeter implements IUsageMeter {
  private instruments?: { calls: Counter; outputTokens: Histogram; duration: Histogram }

  constructor(private readonly getMeter: () => Meter = () => metrics.getMeter('mcp')) {}

  private init() {
    const meter = this.getMeter()
    this.instruments ??= {
      calls: meter.createCounter('mcp_tool_calls_total', { description: 'Chamadas de tool MCP' }),
      outputTokens: meter.createHistogram('mcp_tool_output_tokens_est', {
        description: 'Tokens estimados (caracteres ÷ 4) da resposta da tool',
      }),
      duration: meter.createHistogram('mcp_tool_duration_ms', { unit: 'ms' }),
    }
    return this.instruments
  }

  async record(entry: UsageEntry): Promise<void> {
    const { calls, outputTokens, duration } = this.instruments ?? this.init()
    calls.add(1, { tool: entry.tool, resultado: resultLabel(entry) })
    outputTokens.record(entry.outputTokensEst, { tool: entry.tool })
    duration.record(entry.latencyMs, { tool: entry.tool })
  }
}
