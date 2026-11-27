import { describe, it, expect } from 'vitest'
import { main } from '../../scripts/ai-bom.mjs'

function deps(files: Record<string, string>) {
  const out: string[] = []
  const err: string[] = []
  const escritos: Record<string, string> = {}
  return {
    out,
    err,
    escritos,
    deps: {
      cwd: '/proj',
      readFile: (p: string) => (p in escritos ? escritos[p] : p in files ? files[p] : null),
      writeFile: (p: string, c: string) => {
        escritos[p] = c
      },
      list: (dir: string) => {
        const prefix = `${dir}/`
        const nomes = new Set<string>()
        for (const caminho of Object.keys(files)) {
          if (caminho.startsWith(prefix)) nomes.add(caminho.slice(prefix.length).split('/')[0])
        }
        return [...nomes]
      },
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
    },
  }
}

const files = { '.claude/skills/a/SKILL.md': '---\nname: a\n---\n' }

describe('CLI ai-bom', () => {
  it('sem argumentos grava ai-bom.cdx.json', async () => {
    const d = deps(files)
    expect(await main([], d.deps)).toBe(0)
    expect(JSON.parse(d.escritos['ai-bom.cdx.json']).bomFormat).toBe('CycloneDX')
  })

  it('CT-AIBOM-002 --check com arquivo divergente → exit 1 e orienta', async () => {
    const d = deps({ ...files, 'ai-bom.cdx.json': '{"velho":true}\n' })
    expect(await main(['--check'], d.deps)).toBe(1)
    expect(d.err.join('')).toContain('rode npm run ai-bom')
  })

  it('--check com arquivo igual → exit 0', async () => {
    const d = deps(files)
    await main([], d.deps)
    d.err.length = 0
    expect(await main(['--check'], d.deps)).toBe(0)
    expect(d.err).toEqual([])
  })

  it('CT-AIBOM-011 --check com arquivo ausente → exit 0 com aviso', async () => {
    const d = deps(files)
    expect(await main(['--check'], d.deps)).toBe(0)
    expect(d.err.join('')).toContain('ai-bom.cdx.json')
  })

  it('flag desconhecida → exit 2 com uso', async () => {
    const d = deps(files)
    expect(await main(['--xyz'], d.deps)).toBe(2)
    expect(d.err.join('')).toContain('uso:')
  })

  it('funciona com config ausente e com config desligada', async () => {
    const d = deps({ ...files, 'ai-observabilidade.config.json': '{"ativo":false}' })
    expect(await main([], d.deps)).toBe(0)
  })

  it('CT-AIBOM-005 teto negativo → exit 1 com a mensagem de validação', async () => {
    const d = deps({
      ...files,
      'ai-observabilidade.config.json': '{"ativo":true,"projeto":"x","teto":{"mensalUsd":-10}}',
    })
    expect(await main([], d.deps)).toBe(1)
    expect(d.err.join('')).toContain('teto.mensalUsd deve ser um número positivo')
    expect(d.escritos['ai-bom.cdx.json']).toBeUndefined()
  })

  it('CT-AIBOM-005 JSON inválido na config → exit 1 também em --check', async () => {
    const d = deps({ ...files, 'ai-observabilidade.config.json': '{ quebrado' })
    expect(await main(['--check'], d.deps)).toBe(1)
    expect(d.err.join('')).toContain('JSON inválido')
  })

  it('CT-AIBOM-010 --env imprime exports do projeto sem segredo nem prompts', async () => {
    process.env.GRAFANA_OTLP_TOKEN = 'segredo-xyz'
    try {
      const d = deps({
        ...files,
        'ai-observabilidade.config.json': '{"ativo":true,"projeto":"ContasMes.ai"}',
      })
      expect(await main(['--env'], d.deps)).toBe(0)
      const saida = d.out.join('')
      expect(saida).toContain('export CLAUDE_CODE_ENABLE_TELEMETRY=1')
      expect(saida).toContain('OTEL_RESOURCE_ATTRIBUTES=projeto=ContasMes.ai,origem=local')
      expect(saida).toContain('export OTEL_LOGS_EXPORTER=otlp')
      expect(saida).toContain('export OTEL_METRICS_INCLUDE_SESSION_ID=false')
      expect(saida).not.toContain('OTEL_LOG_USER_PROMPTS=1')
      expect(saida).not.toContain('segredo-xyz')
      expect(saida).toContain('${GRAFANA_OTLP_ENDPOINT}')
      expect(saida).toContain('${GRAFANA_OTLP_HEADERS}')
    } finally {
      delete process.env.GRAFANA_OTLP_TOKEN
    }
  })

  it('CT-AIBOM-006 --env com config desligada → exit 0, stdout vazio, aviso no stderr', async () => {
    const d = deps({ ...files, 'ai-observabilidade.config.json': '{"ativo":false}' })
    expect(await main(['--env'], d.deps)).toBe(0)
    expect(d.out).toEqual([])
    expect(d.err.join('')).toContain('desligada')
  })

  it('CT-AIBOM-006 --env com config ausente → exit 0, stdout vazio, aviso no stderr', async () => {
    const d = deps(files)
    expect(await main(['--env'], d.deps)).toBe(0)
    expect(d.out).toEqual([])
    expect(d.err.join('')).toContain('desligada')
  })

  it('CT-AIBOM-010 --env com emissor (central ausente) ainda imprime os exports', async () => {
    const d = deps({ ...files, 'ai-observabilidade.config.json': '{"ativo":true,"projeto":"p"}' })
    expect(await main(['--env'], d.deps)).toBe(0)
    expect(d.out.join('')).toContain('export OTEL_RESOURCE_ATTRIBUTES=projeto=p,origem=local')
  })
})

describe('CLI ai-bom --env-ci', () => {
  const cfg = { 'ai-observabilidade.config.json': '{"ativo":true,"projeto":"ContasMes.ai"}' }
  const comEnv = (files: Record<string, string>, env: Record<string, string>) => {
    const d = deps(files)
    return { ...d, deps: { ...d.deps, env } }
  }

  it('CT-AIBOM-009 imprime NAME=VALUE resolvido, origem ci, sem export nem prompts', async () => {
    const d = comEnv(
      { ...files, ...cfg },
      {
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.exemplo',
        GRAFANA_OTLP_HEADERS: 'Authorization=Basic abc',
      }
    )
    expect(await main(['--env-ci'], d.deps)).toBe(0)
    const saida = d.out.join('')
    expect(saida).toContain('OTEL_RESOURCE_ATTRIBUTES=projeto=ContasMes.ai,origem=ci')
    expect(saida).toContain('OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.exemplo')
    expect(saida).toContain('OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic abc')
    expect(saida).not.toContain('export ')
    expect(saida).not.toContain('OTEL_LOG_USER_PROMPTS')
  })

  it('CT-AIBOM-009 config desligada → exit 0, stdout vazio', async () => {
    const d = comEnv({ ...files, 'ai-observabilidade.config.json': '{"ativo":false}' }, {})
    expect(await main(['--env-ci'], d.deps)).toBe(0)
    expect(d.out).toEqual([])
    expect(d.err.join('')).toContain('desligada')
  })

  it('CT-AIBOM-009 sem endpoint ou headers no env → exit 0, stdout vazio, aviso', async () => {
    const d = comEnv({ ...files, ...cfg }, { GRAFANA_OTLP_ENDPOINT: 'https://x' })
    expect(await main(['--env-ci'], d.deps)).toBe(0)
    expect(d.out).toEqual([])
    expect(d.err.join('')).toContain('ausente')
  })
})
