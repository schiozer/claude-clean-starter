import { describe, it, expect } from 'vitest'
import {
  grepDe,
  paraItem,
  selecionarCenarios,
  specDaTag,
  tagDoCommit,
} from '../../scripts/demos/selecao.mjs'

const cenario = (id: string, path: string, destinos: string[], aposentado: string | null = null) =>
  ({
    id,
    titulo: `Título ${id}`,
    tipo: 'fluxo',
    destinos,
    criterios: [],
    perfil: null,
    foraDaRegressao: null,
    aposentado,
    passos: [],
    path,
    linha: 1,
  }) as never

const cenarios = [
  cenario('CT-RES-002', 'specs/b.md', ['@treinamento']),
  cenario('CT-RES-001', 'specs/a.md', ['@demo']),
  cenario('CT-RES-003', 'specs/b.md', ['@demo']),
  cenario('CT-RES-004', 'specs/b.md', ['@demo', '@treinamento'], 'obsoleto'),
]

describe('selecionarCenarios', () => {
  it('seleciona demos da spec e todo o treinamento, sem aposentados', () => {
    const sel = selecionarCenarios({ cenarios, spec: 'specs/a.md' })
    expect(sel.demos.map((c: { id: string }) => c.id)).toEqual(['CT-RES-001'])
    expect(sel.treinamento.map((c: { id: string }) => c.id)).toEqual(['CT-RES-002'])
  })

  it('sem spec não há demos', () => {
    expect(selecionarCenarios({ cenarios, spec: null }).demos).toEqual([])
  })
})

describe('grepDe e paraItem', () => {
  it('une IDs únicos por | e normaliza o perfil', () => {
    expect(grepDe({ demos: [{ id: 'A' }, { id: 'B' }], treinamento: [{ id: 'B' }] })).toBe('A|B')
    expect(grepDe({ demos: [], treinamento: [] })).toBe('')
    expect(paraItem(cenarios[0]).perfil).toBe('usuário final')
    expect(paraItem(cenarios[0]).contexto).toBe('RES')
  })
})

describe('tagDoCommit', () => {
  it('só considera tags vX.Y.Z', () => {
    const tags = [
      { name: 'latest', sha: 's1' },
      { name: 'v1.2.0', sha: 's1' },
    ]
    expect(tagDoCommit(tags, 's1')).toBe('v1.2.0')
    expect(tagDoCommit(tags, 's2')).toBeNull()
  })
})

describe('specDaTag', () => {
  const api = (body: string, merged: string | null = '2026-11-01', base = 'main') => ({
    tags: async () => [{ name: 'v1.0.0', sha: 'abc' }],
    pullsForCommit: async () => [{ body, merged_at: merged, base: { ref: base } }],
  })

  it('PR não mergeado na main dá spec null', async () => {
    const corpo = 'Spec: docs/superpowers/specs/x.md'
    expect((await specDaTag(api(corpo, null), 'v1.0.0')).spec).toBeNull()
    expect((await specDaTag(api(corpo, '2026-11-01', 'dev'), 'v1.0.0')).spec).toBeNull()
  })

  it('devolve o caminho da spec do PR', async () => {
    const r = await specDaTag(api('Spec: docs/superpowers/specs/x.md'), 'v1.0.0')
    expect(r).toEqual({ versao: 'v1.0.0', sha: 'abc', spec: 'docs/superpowers/specs/x.md' })
  })

  it('Spec n/a dá null', async () => {
    expect((await specDaTag(api('Spec: n/a — refactor'), 'v1.0.0')).spec).toBeNull()
  })

  it('tag inexistente rejeita', async () => {
    await expect(specDaTag(api(''), 'v9.9.9')).rejects.toThrow('demos: tag v9.9.9 não encontrada')
  })
})
