import { describe, it, expect } from 'vitest'
import type { Meter } from '@opentelemetry/api'
import { OtelUsageMeter, type UsageEntry } from '@/shared/mcp'

interface Point {
  value: number
  attributes: Record<string, unknown>
}

function fakeMeter() {
  const points: Record<string, Point[]> = {}
  const instrument = (name: string, method: 'add' | 'record') => ({
    [method]: (value: number, attributes: Record<string, unknown> = {}) => {
      ;(points[name] ??= []).push({ value, attributes })
    },
  })
  const meter = {
    createCounter: (name: string) => instrument(name, 'add'),
    createHistogram: (name: string) => instrument(name, 'record'),
  } as unknown as Meter
  return { meter, points }
}

const entry = (over: Partial<UsageEntry> = {}): UsageEntry => ({
  at: '2026-01-01T00:00:00.000Z',
  tenantId: 't1',
  tool: 'list_resources',
  outcome: 'ok',
  latencyMs: 12,
  outputTokensEst: 300,
  ...over,
})

describe('OtelUsageMeter', () => {
  it('CT-MCPU-008 métricas de tenants diferentes têm só os rótulos tool e resultado, iguais entre si', async () => {
    const { meter, points } = fakeMeter()
    const otel = new OtelUsageMeter(meter)

    await otel.record(entry({ tenantId: 't1' }))
    await otel.record(entry({ tenantId: 't2' }))

    const calls = points['mcp_tool_calls_total'] ?? []
    expect(calls).toHaveLength(2)
    for (const point of calls) expect(point.attributes).toEqual({ tool: 'list_resources', resultado: 'ok' })
    for (const name of ['mcp_tool_output_tokens_est', 'mcp_tool_duration_ms']) {
      for (const point of points[name] ?? []) expect(point.attributes).toEqual({ tool: 'list_resources' })
    }
  })

  it('histogramas recebem tokens estimados e latência', async () => {
    const { meter, points } = fakeMeter()
    await new OtelUsageMeter(meter).record(entry())
    expect(points['mcp_tool_output_tokens_est']?.[0]?.value).toBe(300)
    expect(points['mcp_tool_duration_ms']?.[0]?.value).toBe(12)
    expect(points['mcp_tool_calls_total']?.[0]?.value).toBe(1)
  })

  it('erro conhecido vira o próprio código no rótulo', async () => {
    const { meter, points } = fakeMeter()
    await new OtelUsageMeter(meter).record(entry({ outcome: 'error', code: 'FORBIDDEN' }))
    expect(points['mcp_tool_calls_total']?.[0]?.attributes).toEqual({ tool: 'list_resources', resultado: 'FORBIDDEN' })
  })

  it('código desconhecido vira INTERNAL_ERROR (cardinalidade fechada)', async () => {
    const { meter, points } = fakeMeter()
    await new OtelUsageMeter(meter).record(entry({ outcome: 'error', code: 'CODIGO_INVENTADO_123' }))
    expect(points['mcp_tool_calls_total']?.[0]?.attributes).toEqual({
      tool: 'list_resources',
      resultado: 'INTERNAL_ERROR',
    })
  })

  it('funciona sem SDK registrado (meter padrão é no-op)', async () => {
    await expect(new OtelUsageMeter().record(entry())).resolves.toBeUndefined()
  })
})
