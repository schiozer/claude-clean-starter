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
