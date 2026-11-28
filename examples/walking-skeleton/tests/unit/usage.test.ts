import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CompositeUsageMeter,
  InMemoryUsageMeter,
  NullUsageMeter,
  estimateTokens,
  type IUsageMeter,
  type UsageEntry,
} from '@/shared/mcp'
import { logError } from '@/shared/logError'

vi.mock('@/shared/logError', () => ({ logError: vi.fn() }))

const entry = (tool: string): UsageEntry => ({
  at: '2026-01-01T00:00:00.000Z',
  tenantId: 't1',
  tool,
  outcome: 'ok',
  latencyMs: 1,
  outputTokensEst: 1,
})

beforeEach(() => vi.clearAllMocks())

describe('estimateTokens', () => {
  it('arredonda caracteres ÷ 4 para cima', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('NullUsageMeter', () => {
  it('resolve sem efeito', async () => {
    await expect(new NullUsageMeter().record(entry('a'))).resolves.toBeUndefined()
  })
})

describe('InMemoryUsageMeter', () => {
  it('mantém só as últimas N entradas, na ordem', async () => {
    const meter = new InMemoryUsageMeter(2)
    for (const tool of ['a', 'b', 'c']) await meter.record(entry(tool))
    expect(meter.entries.map((e) => e.tool)).toEqual(['b', 'c'])
  })

  it('clear esvazia', async () => {
    const meter = new InMemoryUsageMeter()
    await meter.record(entry('a'))
    meter.clear()
    expect(meter.entries).toHaveLength(0)
  })
})

describe('CompositeUsageMeter', () => {
  it('falha de um medidor (rejeição) não impede os demais e é logada', async () => {
    const memory = new InMemoryUsageMeter()
    const broken: IUsageMeter = { record: () => Promise.reject(new Error('neon fora')) }

    await expect(new CompositeUsageMeter([broken, memory]).record(entry('a'))).resolves.toBeUndefined()

    expect(memory.entries).toHaveLength(1)
    expect(logError).toHaveBeenCalledTimes(1)
  })

  it('falha síncrona de um medidor também não impede os demais', async () => {
    const memory = new InMemoryUsageMeter()
    const throwing: IUsageMeter = {
      record: () => {
        throw new Error('sync')
      },
    }

    await expect(new CompositeUsageMeter([throwing, memory]).record(entry('a'))).resolves.toBeUndefined()

    expect(memory.entries).toHaveLength(1)
    expect(logError).toHaveBeenCalledTimes(1)
  })
})
