import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { cenariosAlterados, montarGrep } from '../../scripts/e2e/grep-regressao.mjs'

const SPEC = 'docs/superpowers/specs/2026-01-01-recursos.md'

const cenario = (id: string, extra = '', passo = 'vejo a lista') => `### ${id} — Cenário ${id}

Tipo: @e2e Destino: @regressao${extra}

Dado que estou logado
Então ${passo}
`

const spec = (...blocos: string[]) => `# Spec\n\n## Cenários de teste\n\n${blocos.join('\n')}`

describe('montarGrep', () => {
  it('sem cenários novos → só @regressao', () => {
    expect(montarGrep([])).toBe('@regressao')
  })

  it('acrescenta os IDs em alternância, sem repetir', () => {
    expect(montarGrep(['CT-RES-010', 'CT-RES-011', 'CT-RES-010'])).toBe(
      '@regressao|CT-RES-010|CT-RES-011'
    )
  })

  it('escapa metacaracteres de regex', () => {
    expect(montarGrep(['A.B(1)'])).toBe('@regressao|A\\.B\\(1\\)')
  })
})

describe('cenariosAlterados', () => {
  it('spec nova (sem base) → todos os cenários', () => {
    const ids = cenariosAlterados([
      { path: SPEC, head: spec(cenario('CT-RES-001'), cenario('CT-RES-002')), base: null },
    ])
    expect(ids).toEqual(['CT-RES-001', 'CT-RES-002'])
  })

  it('spec alterada → só os cenários novos ou com conteúdo mudado', () => {
    const base = spec(cenario('CT-RES-001'), cenario('CT-RES-002'))
    const head = spec(
      cenario('CT-RES-001'),
      cenario('CT-RES-002', '', 'vejo o selo'),
      cenario('CT-RES-003')
    )
    expect(cenariosAlterados([{ path: SPEC, head, base }])).toEqual(['CT-RES-002', 'CT-RES-003'])
  })

  it('ignora aposentados e fora da regressão', () => {
    const head = spec(
      cenario('CT-RES-001', '\nAposentado: substituído pelo CT-RES-002'),
      cenario('CT-RES-002', '\nFora da regressão: instável no Safari'),
      cenario('CT-RES-003')
    )
    expect(cenariosAlterados([{ path: SPEC, head, base: null }])).toEqual(['CT-RES-003'])
  })

  it('spec sem cenários → vazio', () => {
    expect(cenariosAlterados([{ path: SPEC, head: '# só texto\n', base: null }])).toEqual([])
  })
})

describe('workflow e2e-regressao.yml: projeto sem E2E configurado', () => {
  const workflow = readFileSync(
    resolve(__dirname, '../../.github/workflows/e2e-regressao.yml'),
    'utf8'
  )
  const passos = workflow.split(/\n {6}- /).slice(1)
  const indiceDeteccao = passos.findIndex((p) =>
    p.startsWith('name: Detectar a configuração do E2E')
  )
  const deteccao = passos[indiceDeteccao] ?? ''
  const CONFIGURADO = "steps.config.outputs.configurado == 'true'"

  it('detecta a falta de playwright.config.ts ou de tests/e2e/cenarios.config.json', () => {
    expect(indiceDeteccao).toBeGreaterThan(0)
    expect(passos[indiceDeteccao - 1]).toMatch(/uses: actions\/checkout/)
    expect(deteccao).toContain('id: config')
    expect(deteccao).toContain('playwright.config.ts')
    expect(deteccao).toContain('tests/e2e/cenarios.config.json')
    expect(deteccao).toContain('configurado=false')
    expect(deteccao).toContain('configurado=true')
  })

  it('avisa no summary e com ::warning::, sem falhar o job', () => {
    expect(deteccao).toContain('$GITHUB_STEP_SUMMARY')
    expect(deteccao).toContain('::warning::')
    expect(deteccao).toContain('E2E não configurado — ver docs/guides/e2e-guide.md, Adoção')
    expect(deteccao).not.toMatch(/exit 1/)
  })

  it('todos os passos depois da detecção são pulados sem a configuração', () => {
    const seguintes = passos.slice(indiceDeteccao + 1)
    expect(seguintes.length).toBeGreaterThan(5)
    for (const passo of seguintes) {
      const nome = /^name: (.+)$/m.exec(passo)?.[1] ?? passo.split('\n')[0]
      expect(passo, nome).toMatch(/^ +if: .+$/m)
      expect(/^ +if: (.+)$/m.exec(passo)?.[1], nome).toContain(CONFIGURADO)
    }
  })
})
