import { describe, it, expect } from 'vitest'
import { checkCenarios } from '../../scripts/check-cenarios.mjs'
import {
  DEFAULT_CONFIG,
  globToRegExp,
  montarIndice,
  rnfsDeclarados,
  rotaDaPagina,
} from '../../scripts/e2e/config.mjs'

const SPEC_PR = 'docs/superpowers/specs/2026-01-01-recursos.md'
const SPEC_VELHA = 'docs/superpowers/specs/2025-01-01-velha.md'
const RNF_PATH = 'docs/rnf.md'
const APP = 'examples/walking-skeleton/src/app'

const PUBLICAR = `### CT-RES-001 — Publicar um recurso

Tipo: @e2e Destino: @doc
Critério: CA-1 Perfil: usuário final

Dado que estou logado
Quando publico o recurso "Plano"
Então vejo o selo "Publicado"
`

const LISTAR = `### CT-VEL-001 — Listar recursos

Tipo: @e2e
Critério: CA-1

Dado que estou logado
Então vejo a lista
`

const spec = (cenarios: string, rnfs = 'Segue o baseline.') =>
  `# Spec\n\n## 7. Requisitos não funcionais\n\n${rnfs}\n\n## 8. Cenários de teste\n\n${cenarios}\n## 9. Fim\n`

const RNF_MD = `# RNF

| ID | Categoria | Requisito | Valor |
| --- | --- | --- | --- |
| RNF-SEG-001 | Hardening | Headers | — |

## Telas principais

| Rota | Nome |
| --- | --- |
| / | Início |

## Exclusões

- /resources
`

type Spec = { path: string; markdown: string }
const indiceDe = (specs: Spec[], rnf: string | null = RNF_MD) =>
  montarIndice({
    config: DEFAULT_CONFIG,
    specs,
    rnf: rnf === null ? null : { path: RNF_PATH, markdown: rnf },
  })

const PASSOS_PUBLICAR = ['que estou logado', 'publico o recurso "Plano"', 'vejo o selo "Publicado"']
const ref = (over: Record<string, unknown> = {}) => ({
  id: 'CT-RES-001',
  titulo: 'CT-RES-001 publicar',
  tags: ['@e2e', '@regressao', '@doc'],
  passos: PASSOS_PUBLICAR,
  path: 'tests/e2e/recursos.spec.ts',
  linha: 3,
  ...over,
})
const doc = (passos = PASSOS_PUBLICAR) => ({
  id: 'CT-RES-001',
  titulo: 'Publicar um recurso',
  perfil: 'usuário final',
  passos: passos.map((texto, i) => ({ texto, imagem: `${i + 1}.png` })),
})

type Entrada = Partial<Parameters<typeof checkCenarios>[0]>
const rodar = (entrada: Entrada & { specs?: Spec[] } = {}) => {
  const { specs = [{ path: SPEC_PR, markdown: spec(PUBLICAR) }], ...resto } = entrada
  return checkCenarios({
    indice: indiceDe(specs),
    refs: [ref()],
    ajudaFiles: new Map([['CT-RES-001', doc()]]),
    paginas: [],
    specDoPr: SPEC_PR,
    paginasNovas: [],
    ...resto,
  })
}

describe('rotaDaPagina / globToRegExp', () => {
  it.each([
    ['src/app/page.tsx', '/'],
    ['src/app/(painel)/recursos/page.tsx', '/recursos'],
    ['src/app/recursos/[id]/page.tsx', '/recursos/[id]'],
    ['src/app/(a)/(b)/x/[id]/page.tsx', '/x/[id]'],
  ])('rotaDaPagina(%s) = %s', (p, r) => expect(rotaDaPagina(p, 'src/app')).toBe(r))

  it('aceita appDir com barra final', () => {
    expect(rotaDaPagina(`${APP}/resources/page.tsx`, `${APP}/`)).toBe('/resources')
  })

  it('* não atravessa pastas; ** casa em qualquer profundidade', () => {
    const specs = globToRegExp('docs/superpowers/specs/*.md')
    expect(specs.test('docs/superpowers/specs/a.md')).toBe(true)
    expect(specs.test('docs/superpowers/specs/sub/a.md')).toBe(false)
    const testes = globToRegExp('tests/e2e/**/*.spec.ts')
    expect(testes.test('tests/e2e/a.spec.ts')).toBe(true)
    expect(testes.test('tests/e2e/x/y/a.spec.ts')).toBe(true)
    expect(testes.test('tests/unit/a.spec.ts')).toBe(false)
  })
})

describe('rnfsDeclarados', () => {
  it('só lê IDs da seção "Requisitos não funcionais"', () => {
    const md = spec(LISTAR, 'RNF-TMO-010: upload até 30 s (baseline 10 s)\nUSA-007: atalho')
    expect(rnfsDeclarados(md).map((r) => r.id)).toEqual(['RNF-TMO-010', 'USA-007'])
    expect(rnfsDeclarados('## Outra\n\nRNF-TMO-010')).toEqual([])
  })
})

describe('checkCenarios', () => {
  it('spec do PR sem nenhum problema → sem erros e relatório com uma linha por cenário', () => {
    const specs = [
      { path: SPEC_PR, markdown: spec(PUBLICAR) },
      { path: SPEC_VELHA, markdown: spec(LISTAR) },
    ]
    const refs = [
      ref(),
      ref({
        id: 'CT-VEL-001',
        tags: ['@e2e', '@regressao'],
        passos: ['que estou logado', 'vejo a lista'],
      }),
    ]
    const r = rodar({ specs, refs })
    expect(r.erros).toEqual([])
    expect(r.avisos).toEqual([])
    expect(r.relatorio).toContain('| Cenário | Critério | Teste | Doc | Situação |')
    const linhas = r.relatorio.split('\n').filter((l) => l.startsWith('| CT-'))
    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toContain('CA-1')
    expect(linhas[0]).toContain('tests/e2e/recursos.spec.ts:3')
    expect(linhas[0]).toContain('ok')
  })

  it('cenário @regressao sem teste → erro na spec do PR', () => {
    const r = rodar({ refs: [] })
    expect(r.erros).toEqual([
      expect.stringMatching(
        /^docs\/superpowers\/specs\/2026-01-01-recursos\.md:\d+: .*CT-RES-001.*sem teste/
      ),
    ])
    expect(r.relatorio).toContain('sem teste')
  })

  it('cenário @regressao sem teste → aviso em spec antiga', () => {
    const r = rodar({
      specs: [{ path: SPEC_VELHA, markdown: spec(LISTAR) }],
      refs: [],
      ajudaFiles: new Map(),
    })
    expect(r.erros).toEqual([])
    expect(r.avisos).toEqual([expect.stringContaining('CT-VEL-001')])
  })

  it('cenário fora da regressão não exige teste', () => {
    const fora = LISTAR.replace('Critério: CA-1', 'Critério: CA-1\nFora da regressão: manual')
    const r = rodar({
      specs: [{ path: SPEC_PR, markdown: spec(fora) }],
      refs: [],
      ajudaFiles: new Map(),
    })
    expect(r.erros).toEqual([])
    expect(r.relatorio).toContain('fora da regressão')
  })

  it('teste órfão (sem cenário/RNF/USA) → sempre erro', () => {
    const orfao = ref({ id: 'CT-XYZ-009', path: 'tests/e2e/x.spec.ts', linha: 7 })
    const r = rodar({ refs: [ref(), orfao], specDoPr: null })
    expect(r.erros).toEqual([
      expect.stringMatching(/^tests\/e2e\/x\.spec\.ts:7: .*órfão.*CT-XYZ-009/),
    ])
  })

  it('teste de RNF do baseline ou declarado em spec não é órfão', () => {
    const md = spec(PUBLICAR, 'RNF-TMO-010: upload até 30 s')
    const refs = [
      ref(),
      ref({ id: 'RNF-SEG-001', tags: ['@rnf'], passos: null }),
      ref({ id: 'RNF-TMO-010', tags: ['@rnf'], passos: null }),
    ]
    const r = rodar({ specs: [{ path: SPEC_PR, markdown: md }], refs })
    expect(r.erros).toEqual([])
  })

  it.each([
    [SPEC_PR, 'erros'],
    [null, 'avisos'],
  ] as const)('teste de cenário aposentado (spec do PR = %s) → %s', (specDoPr, onde) => {
    const aposentado = PUBLICAR.replace('Critério: CA-1', 'Critério: CA-1\nAposentado: substituído')
    const r = rodar({ specs: [{ path: SPEC_PR, markdown: spec(aposentado) }], specDoPr })
    expect(r[onde]).toEqual([
      expect.stringMatching(/tests\/e2e\/recursos\.spec\.ts:3: .*aposentado/),
    ])
    expect(r[onde === 'erros' ? 'avisos' : 'erros']).toEqual([])
  })

  it.each([
    [SPEC_PR, 'erros'],
    [null, 'avisos'],
  ] as const)(
    'passos divergentes (spec do PR = %s) → %s com faltando/sobrando',
    (specDoPr, onde) => {
      const passos = ['que estou logado', 'publico o recurso Plano', 'vejo o selo "Publicado"']
      const r = rodar({ refs: [ref({ passos })], specDoPr })
      expect(r[onde]).toHaveLength(1)
      expect(r[onde][0]).toMatch(/^tests\/e2e\/recursos\.spec\.ts:3: /)
      expect(r[onde][0]).toContain('faltando: "publico o recurso "Plano""')
      expect(r[onde][0]).toContain('sobrando: "publico o recurso Plano"')
    }
  )

  it('passos na ordem errada → divergência de ordem', () => {
    const r = rodar({ refs: [ref({ passos: [...PASSOS_PUBLICAR].reverse() })] })
    expect(r.erros).toEqual([expect.stringContaining('ordem')])
  })

  it('@e2e sem jornada() → passos não conferidos', () => {
    const r = rodar({ refs: [ref({ passos: null })] })
    expect(r.erros).toEqual([expect.stringContaining('jornada')])
  })

  it.each([
    [SPEC_PR, 'erros'],
    [null, 'avisos'],
  ] as const)('cenário @doc sem página de ajuda (spec do PR = %s) → %s', (specDoPr, onde) => {
    const r = rodar({ ajudaFiles: new Map(), specDoPr })
    expect(r[onde]).toEqual([expect.stringMatching(/CT-RES-001.*ajuda/)])
    expect(r.relatorio).toContain('falta')
  })

  it.each([
    [SPEC_PR, 'erros'],
    [null, 'avisos'],
  ] as const)('página de ajuda com passos diferentes (spec do PR = %s) → %s', (specDoPr, onde) => {
    const ajudaFiles = new Map([['CT-RES-001', doc(PASSOS_PUBLICAR.slice(0, 2))]])
    const r = rodar({ ajudaFiles, specDoPr })
    expect(r[onde]).toEqual([expect.stringContaining('faltando: "vejo o selo "Publicado""')])
  })

  it('ID duplicado entre specs → sempre erro, nas duas posições', () => {
    const dup = LISTAR.replace('CT-VEL-001', 'CT-RES-001')
    const specs = [
      { path: SPEC_VELHA, markdown: spec(dup) },
      { path: 'docs/superpowers/specs/2024-01-01-outra.md', markdown: spec(dup) },
    ]
    const r = rodar({ specs, refs: [], ajudaFiles: new Map(), specDoPr: null })
    const dups = r.erros.filter((e) => e.includes('duplicado'))
    expect(dups).toHaveLength(1)
    expect(dups[0]).toMatch(/^docs\/superpowers\/specs\/2024-01-01-outra\.md:\d+: .*CT-RES-001/)
    expect(dups[0]).toContain(SPEC_VELHA)
  })

  it.each([
    [SPEC_PR, 'erros'],
    [null, 'avisos'],
  ] as const)('RNF declarado na spec sem teste (spec do PR = %s) → %s', (specDoPr, onde) => {
    const md = spec(PUBLICAR, 'RNF-TMO-010: upload até 30 s')
    const r = rodar({ specs: [{ path: SPEC_PR, markdown: md }], specDoPr })
    expect(r[onde]).toEqual([
      expect.stringMatching(/2026-01-01-recursos\.md:\d+: RNF-TMO-010 .*sem teste/),
    ])
  })

  it.each([
    [[`${APP}/(painel)/nova/[id]/page.tsx`], 'erros'],
    [[], 'avisos'],
  ] as const)('página fora de telas/exclusões (novas = %j) → %s', (paginasNovas, onde) => {
    const paginas = [
      `${APP}/page.tsx`,
      `${APP}/resources/page.tsx`,
      `${APP}/(painel)/nova/[id]/page.tsx`,
    ]
    const r = rodar({ paginas, paginasNovas: [...paginasNovas] })
    expect(r[onde]).toEqual([expect.stringMatching(/\/nova\/\[id\].*docs\/rnf\.md/)])
    expect(r[onde === 'erros' ? 'avisos' : 'erros']).toEqual([])
  })

  it.each([
    [SPEC_PR, 'erros'],
    [null, 'avisos'],
  ] as const)('tag diferente do tipo/destinos (spec do PR = %s) → %s', (specDoPr, onde) => {
    const r = rodar({ refs: [ref({ tags: ['@sistemico', '@regressao'] })], specDoPr })
    expect(r[onde]).toHaveLength(1)
    expect(r[onde][0]).toContain('faltando: @e2e, @doc')
    expect(r[onde][0]).toContain('sobrando: @sistemico')
  })

  it('Spec: n/a → só checagens globais (órfão, duplicado) e o resto vira aviso', () => {
    const dup = LISTAR.replace('CT-VEL-001', 'CT-RES-001')
    const specs = [
      { path: SPEC_PR, markdown: spec(PUBLICAR) },
      { path: SPEC_VELHA, markdown: spec(dup) },
    ]
    const refs = [ref({ id: 'CT-ABC-001' })]
    const r = rodar({ specs, refs, ajudaFiles: new Map(), specDoPr: null })
    expect(r.erros).toHaveLength(2)
    expect(r.erros.some((e) => e.includes('órfão'))).toBe(true)
    expect(r.erros.some((e) => e.includes('duplicado'))).toBe(true)
    expect(r.avisos.length).toBeGreaterThan(0)
  })

  it('spec malformada → erro com arquivo:linha, sem throw', () => {
    const ruim = '### CT-RES-002 — Sem tipo\n\nDado que estou logado\npasso sem palavra\n'
    const specs = [{ path: SPEC_PR, markdown: spec(PUBLICAR + '\n' + ruim) }]
    let r: ReturnType<typeof checkCenarios> | undefined
    expect(() => (r = rodar({ specs }))).not.toThrow()
    expect(r!.erros).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^docs\/superpowers\/specs\/2026-01-01-recursos\.md:\d+: .*Tipo/),
        expect.stringMatching(
          /^docs\/superpowers\/specs\/2026-01-01-recursos\.md:\d+: .*passo sem palavra/
        ),
      ])
    )
  })

  it('spec antiga malformada → aviso', () => {
    const ruim = '### CT-VEL-002 — Sem tipo\n\nDado que estou logado\n'
    const specs = [
      { path: SPEC_PR, markdown: spec(PUBLICAR) },
      { path: SPEC_VELHA, markdown: spec(ruim) },
    ]
    const r = rodar({ specs })
    expect(r.erros).toEqual([])
    expect(r.avisos).toEqual([
      expect.stringMatching(/^docs\/superpowers\/specs\/2025-01-01-velha\.md:\d+: .*Tipo/),
    ])
  })

  it('sem docs/rnf.md → índice vazio e um aviso, sem throw', () => {
    const indice = indiceDe([{ path: SPEC_PR, markdown: spec(PUBLICAR) }], null)
    const r = checkCenarios({
      indice,
      refs: [ref()],
      ajudaFiles: new Map([['CT-RES-001', doc()]]),
      paginas: [`${APP}/page.tsx`],
      specDoPr: SPEC_PR,
      paginasNovas: [],
    })
    expect(r.erros).toEqual([])
    expect(r.avisos).toEqual([
      expect.stringContaining('docs/rnf.md'),
      expect.stringMatching(/página .*'\/'/),
    ])
  })

  it('erros de leitura dos testes (ex.: chave não literal) → erro', () => {
    const r = rodar({
      errosLeitura: [
        { path: 'tests/e2e/a.spec.ts', linha: 5, mensagem: 'chave de passo não literal' },
      ],
    })
    expect(r.erros).toEqual(['tests/e2e/a.spec.ts:5: chave de passo não literal'])
  })

  it('escapa | nas células do relatório', () => {
    const titulo = PUBLICAR.replace('Publicar um recurso', 'Publicar | arquivar')
    const r = rodar({ specs: [{ path: SPEC_PR, markdown: spec(titulo) }] })
    expect(r.relatorio).toContain('Publicar \\| arquivar')
  })
})
