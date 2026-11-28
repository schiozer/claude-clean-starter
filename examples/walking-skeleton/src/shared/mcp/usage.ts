import { logError } from '@/shared/logError'

/**
 * Uma chamada de tool medida. Nunca carrega argumentos, conteúdo da resposta nem o id do ator:
 * é o mínimo que cumpre a auditoria de uso por tenant.
 */
export interface UsageEntry {
  at: string
  tenantId: string
  tool: string
  outcome: 'ok' | 'error'
  code?: string
  latencyMs: number
  /** Estimativa (caracteres ÷ 4) do texto da resposta; o produto não enxerga os tokens reais do cliente. */
  outputTokensEst: number
}

export interface IUsageMeter {
  record(entry: UsageEntry): Promise<void>
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Flag desligada: nada é medido. */
export class NullUsageMeter implements IUsageMeter {
  async record(_entry: UsageEntry): Promise<void> {}
}

/** Em memória no skeleton, com teto para não vazar memória. Em projeto real: tabela `mcp_uso_diario`. */
export class InMemoryUsageMeter implements IUsageMeter {
  private items: UsageEntry[] = []

  constructor(private readonly maxEntries = 10_000) {}

  get entries(): readonly UsageEntry[] {
    return this.items
  }

  async record(entry: UsageEntry): Promise<void> {
    this.items.push(entry)
    if (this.items.length > this.maxEntries) this.items = this.items.slice(-this.maxEntries)
  }

  clear(): void {
    this.items = []
  }
}

/** Fail-open: a falha de um medidor é logada e não impede os demais. */
export class CompositeUsageMeter implements IUsageMeter {
  constructor(private readonly meters: readonly IUsageMeter[]) {}

  async record(entry: UsageEntry): Promise<void> {
    const results = await Promise.allSettled(this.meters.map(async (meter) => meter.record(entry)))
    for (const result of results) {
      if (result.status === 'rejected') logError('mcp:usage', result.reason)
    }
  }
}
