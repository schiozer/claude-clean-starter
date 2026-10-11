import { RateLimitedError } from '@/shared/errors'
import { systemClock, type Clock } from '@/shared/kernel'

export interface IRateLimiter {
  /** Conta uma chamada para a chave; estourou o limite → RateLimitedError. */
  consume(key: string): Promise<void>
}

/** Janela fixa em memória (skeleton). Em projeto real: tabela Postgres (ADR-010). */
export class InMemoryRateLimiter implements IRateLimiter {
  private windows = new Map<string, { start: number; count: number }>()

  constructor(
    private readonly options: { limit: number; windowMs: number },
    private readonly clock: Clock = systemClock
  ) {}

  async consume(key: string): Promise<void> {
    const now = this.clock.now().getTime()
    const window = this.windows.get(key)
    if (!window || now - window.start >= this.options.windowMs) {
      this.windows.set(key, { start: now, count: 1 })
      return
    }
    if (window.count >= this.options.limit) throw new RateLimitedError()
    window.count += 1
  }

  clear(): void {
    this.windows.clear()
  }
}
