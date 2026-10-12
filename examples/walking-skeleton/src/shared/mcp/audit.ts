import type { AuthVia } from '@/shared/auth'

/** Quem chamou qual tool de escrita, quando e com que resultado — nunca o payload. */
export interface AuditEntry {
  at: string
  actorId: string
  tenantId: string
  via: AuthVia
  tool: string
  outcome: 'ok' | 'error'
  code?: string
}

export interface IAuditLog {
  record(entry: AuditEntry): Promise<void>
}

/** Em memória no skeleton; em projeto real, uma tabela de auditoria append-only. */
export class InMemoryAuditLog implements IAuditLog {
  private readonly items: AuditEntry[] = []

  get entries(): readonly AuditEntry[] {
    return this.items
  }

  async record(entry: AuditEntry): Promise<void> {
    this.items.push(entry)
  }

  clear(): void {
    this.items.length = 0
  }
}
