import { describe, it, expect } from 'vitest'
import { InMemoryRateLimiter, InMemoryAuditLog } from '@/shared/mcp'
import { RateLimitedError } from '@/shared/errors'
import type { Clock } from '@/shared/kernel'

let now = 0
const clock: Clock = { now: () => new Date(now) }

describe('InMemoryRateLimiter', () => {
  it('permite até o limite e recusa o excedente na mesma janela', async () => {
    now = 0
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 1000 }, clock)
    await limiter.consume('t1:ana')
    await limiter.consume('t1:ana')
    await expect(limiter.consume('t1:ana')).rejects.toThrow(RateLimitedError)
  })

  it('isola por chave (ator)', async () => {
    now = 0
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, clock)
    await limiter.consume('t1:ana')
    await expect(limiter.consume('t1:bia')).resolves.toBeUndefined()
  })

  it('libera na janela seguinte', async () => {
    now = 0
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000 }, clock)
    await limiter.consume('t1:ana')
    now = 1000
    await expect(limiter.consume('t1:ana')).resolves.toBeUndefined()
  })
})

describe('InMemoryAuditLog', () => {
  it('registra e limpa entradas', async () => {
    const audit = new InMemoryAuditLog()
    await audit.record({ at: '2026-01-01T00:00:00.000Z', actorId: 'ana', tenantId: 't1', via: 'pat', tool: 'create_resource', outcome: 'ok' })
    expect(audit.entries).toHaveLength(1)
    audit.clear()
    expect(audit.entries).toHaveLength(0)
  })
})
