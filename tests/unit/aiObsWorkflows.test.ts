import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { envTelemetria } from '../../scripts/ai-observabilidade/metricas.mjs'

const ler = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8')

describe('workflow ai-consumo-diario.yml', () => {
  const yml = ler('.github/workflows/ai-consumo-diario.yml')

  it('CT-AIBOM-008 descobre o papel antes do npm ci e só roda no hub', () => {
    expect(yml).toContain('id: papel')
    expect(yml.indexOf('id: papel')).toBeLessThan(yml.indexOf('npm ci'))
    expect(yml).toContain("hub='+h")
    expect(yml).toContain('GITHUB_OUTPUT')
    const gate = "if: steps.papel.outputs.hub == 'true'"
    expect(yml.split(gate).length - 1).toBeGreaterThanOrEqual(2)
    expect(yml.indexOf(gate)).toBeLessThan(yml.indexOf('npm ci'))
  })

  it('CT-AIBOM-008 mantém cron, dispatch e permissão mínima', () => {
    expect(yml).toContain("cron: '30 3 * * *'")
    expect(yml).toContain('workflow_dispatch:')
    expect(yml).toContain('contents: read')
  })
})

describe('temporalidade e session.id', () => {
  it('CT-AIBOM-010 envTelemetria usa cumulativo e mantém session.id', () => {
    const env = envTelemetria('p', 'local')
    expect(env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE).toBe('cumulative')
    expect(env.OTEL_METRICS_INCLUDE_SESSION_ID).toBe('true')
  })

  it('CT-AIBOM-009 spec-gate repassa cumulativo e session.id pelo settings da action', () => {
    const yml = ler('.github/workflows/spec-gate.yml')
    expect(yml).toContain(
      '"env":{"OTEL_METRICS_INCLUDE_SESSION_ID":"true","OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE":"cumulative"}'
    )
  })
})
