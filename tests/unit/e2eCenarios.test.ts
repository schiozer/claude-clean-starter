import { describe, it, expect } from 'vitest'
import { diffPassos, normalizarPasso, parseCenarios } from '../../scripts/e2e/cenarios.mjs'

const SPEC = `## 8. Cenários de teste

### CT-RES-003 — Publicar um recurso
Tipo: @e2e  Destino: @doc @demo
Critério: CA-2   Perfil: usuário final

Dado que estou logado
Quando abro a lista de recursos
E   publico o recurso "Plano de estudos"
Então vejo o selo "Publicado"
`

const bloco = (linhas: string[]) => `## 8. Cenários de teste\n\n${linhas.join('\n')}\n`

describe('parseCenarios', () => {
  it('lê o cenário com @regressao implícito', () => {
    const { cenarios, erros } = parseCenarios(SPEC, 's.md')
    expect(erros).toEqual([])
    expect(cenarios[0]).toMatchObject({
      id: 'CT-RES-003',
      titulo: 'Publicar um recurso',
      tipo: '@e2e',
      destinos: ['@regressao', '@doc', '@demo'],
      criterios: ['CA-2'],
      perfil: 'usuário final',
      foraDaRegressao: null,
      aposentado: null,
      path: 's.md',
      linha: 3,
    })
    expect(
      cenarios[0].passos.map((p: { palavra: string; texto: string }) =>
        normalizarPasso(`${p.palavra} ${p.texto}`)
      )
    ).toEqual([
      'que estou logado',
      'abro a lista de recursos',
      'publico o recurso "Plano de estudos"',
      'vejo o selo "Publicado"',
    ])
  })

  it('Fora da regressão remove @regressao', () => {
    const md = bloco([
      '### CT-RES-004 — Importar planilha',
      'Tipo: @e2e  Destino: @doc',
      'Critério: CA-1  Perfil: time interno',
      'Fora da regressão: depende de serviço externo',
      '',
      'Dado que estou logado',
      'Então vejo a tela',
    ])
    const { cenarios, erros } = parseCenarios(md, 's.md')
    expect(erros).toEqual([])
    expect(cenarios[0].destinos).toEqual(['@doc'])
    expect(cenarios[0].foraDaRegressao).toBe('depende de serviço externo')
    expect(cenarios[0].perfil).toBe('time interno')
  })

  it('Aposentado é lido e o cenário não exige passos', () => {
    const md = bloco([
      '### CT-RES-005 — Exportar PDF',
      'Tipo: @e2e  Destino: @doc',
      'Critério: CA-3  Perfil: usuário final',
      'Aposentado: substituído por CT-RES-006',
    ])
    const { cenarios, erros } = parseCenarios(md, 's.md')
    expect(erros).toEqual([])
    expect(cenarios[0].aposentado).toBe('substituído por CT-RES-006')
    expect(cenarios[0].passos).toEqual([])
  })

  it('exige passos quando o cenário não está aposentado', () => {
    const md = bloco(['### CT-RES-005 — Sem passos', 'Tipo: @e2e', 'Critério: CA-1'])
    const { erros } = parseCenarios(md, 's.md')
    expect(erros[0]).toMatchObject({ path: 's.md', linha: 3 })
    expect(erros[0].mensagem).toMatch(/passo/)
  })

  it.each([
    ['sem Tipo', ['### CT-RES-001 — A', 'Critério: CA-1', 'Dado x'], /Tipo/, 3],
    ['ID fora do padrão (CT-R-1)', ['### CT-R-1 — A', 'Tipo: @e2e', 'Dado x'], /ID/, 3],
    [
      'linha solta que não é passo nem metadado',
      ['### CT-RES-001 — A', 'Tipo: @e2e', 'Dado x', 'isto é texto solto'],
      /passo/,
      6,
    ],
    ['dois Tipos (@e2e @rnf)', ['### CT-RES-001 — A', 'Tipo: @e2e @rnf', 'Dado x'], /um tipo/, 4],
  ])('erro com linha: %s', (_nome, linhas, mensagem, linha) => {
    const resultado = parseCenarios(bloco(linhas as string[]), 's.md')
    expect(resultado.erros[0].linha).toBe(linha)
    expect(resultado.erros[0].mensagem).toMatch(mensagem as RegExp)
    expect(resultado.erros[0].path).toBe('s.md')
  })

  it.each(['-', '–', '--'])("heading com '%s' no lugar de '—' sugere o travessão", (traco) => {
    const md = bloco([`### CT-RES-001 ${traco} Criar um recurso`, 'Tipo: @e2e', 'Dado x'])
    const { erros } = parseCenarios(md, 's.md')
    expect(erros).toHaveLength(1)
    expect(erros[0].linha).toBe(3)
    expect(erros[0].mensagem).toMatch(/use '—' \(travessão\)/)
    expect(erros[0].mensagem).toContain('### CT-RES-001 — Criar um recurso')
  })

  it('ignora blocos ### fora da seção Cenários de teste', () => {
    const md = `## 3. Fluxo\n\n### qualquer coisa sem formato\ntexto solto\n\n${SPEC}\n## 9. Outro\n\n### outro heading\nlixo\n`
    const { cenarios, erros } = parseCenarios(md, 's.md')
    expect(erros).toEqual([])
    expect(cenarios.map((c: { id: string }) => c.id)).toEqual(['CT-RES-003'])
  })

  it('valida destino, critério e perfil desconhecidos', () => {
    const md = bloco([
      '### CT-RES-001 — A',
      'Tipo: @e2e  Destino: @foo',
      'Critério: X-1  Perfil: alienígena',
      'Dado x',
    ])
    const { erros } = parseCenarios(md, 's.md')
    expect(erros.map((e: { mensagem: string }) => e.mensagem).join('\n')).toMatch(
      /Destino[\s\S]*Critério[\s\S]*Perfil/
    )
  })
})

describe('normalizarPasso', () => {
  it('remove a palavra inicial e colapsa espaços, preservando acentos, aspas e caixa', () => {
    expect(normalizarPasso('Então   vejo  o selo  "Publicado"')).toBe('vejo o selo "Publicado"')
    expect(normalizarPasso('E publico')).toBe('publico')
    expect(normalizarPasso('Mas   não   vejo')).toBe('não vejo')
  })
})

describe('diffPassos', () => {
  it('iguais → null; ordem trocada, faltando e sobrando são descritos', () => {
    expect(diffPassos(['a', 'b'], ['a', 'b'])).toBeNull()
    expect(diffPassos(['a', 'b'], ['b', 'a'])).toBe(
      'mesmos passos em ordem diferente (esperado: "a", "b")'
    )
    expect(diffPassos(['a', 'b'], ['a', 'c'])).toBe('faltando: "b"; sobrando: "c"')
  })
})
