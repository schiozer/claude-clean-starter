import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  COMMENT_MARKER,
  VERDICT_SCHEMA,
  buildComment,
  buildPrompt,
  evaluateVerdict,
  previousResult,
  shouldAnalyze,
  specSection,
} from '../../scripts/spec-gate.mjs'

const ROOT = resolve(__dirname, '../..')

const verdict = (overrides: Record<string, unknown> = {}) => ({
  criterios: [{ criterio: 'A', status: 'ok', evidencia: 'src/a.ts' }],
  divergencias: [],
  resumo: 'tudo certo',
  ...overrides,
})

describe('evaluateVerdict', () => {
  it('ok quando tudo está ok', () => {
    expect(evaluateVerdict(verdict())).toEqual({ ok: true, reasons: [] })
  })

  it('vermelho quando algum critério está fora', () => {
    const raw = verdict({ criterios: [{ criterio: 'B', status: 'fora', evidencia: '-' }] })
    const result = evaluateVerdict(raw)
    expect(result.ok).toBe(false)
    expect(result.reasons.join('\n')).toContain('B')
  })

  it('parcial, sem-teste e divergência não bloqueante geram só avisos', () => {
    const raw = verdict({
      criterios: [
        { criterio: 'C', status: 'parcial', evidencia: '-' },
        { criterio: 'D', status: 'sem-teste', evidencia: '-' },
      ],
      divergencias: [{ descricao: 'nome diferente', bloqueante: false }],
    })
    const result = evaluateVerdict(raw)
    expect(result.ok).toBe(true)
    expect(result.reasons).toHaveLength(3)
  })

  it('vermelho com divergência bloqueante', () => {
    const raw = verdict({ divergencias: [{ descricao: 'endpoint ausente', bloqueante: true }] })
    const result = evaluateVerdict(raw)
    expect(result.ok).toBe(false)
    expect(result.reasons.join('\n')).toContain('endpoint ausente')
  })

  it.each([
    ['null', null],
    ['string quebrada', '{'],
    ['sem criterios', { divergencias: [], resumo: 'x' }],
    [
      'status inválido',
      verdict({ criterios: [{ criterio: 'A', status: 'talvez', evidencia: '' }] }),
    ],
    ['bloqueante não booleano', verdict({ divergencias: [{ descricao: 'x', bloqueante: 'sim' }] })],
    ['sem resumo', { criterios: [], divergencias: [] }],
  ])('vermelho "saída do Claude inválida" para %s', (_name, raw) => {
    const result = evaluateVerdict(raw)
    expect(result.ok).toBe(false)
    expect(result.reasons[0]).toContain('saída do Claude inválida')
  })
})

describe('shouldAnalyze', () => {
  const section = (cell: string, spec = 'docs/superpowers/specs/a.md') =>
    `Spec: ${spec}\n\n## Spec × código\n\n| Critério | Onde |\n| --- | --- |\n| A | ${cell} |\n\n## UAT\n\n- [ ] UAT aprovado\n`

  it.each(['opened', 'synchronize', 'reopened'])('%s analisa', (action) => {
    expect(shouldAnalyze({ action, body: section('x') })).toBe(true)
  })

  it('edited sem previousBody (só o título mudou) não analisa', () => {
    expect(shouldAnalyze({ action: 'edited', body: section('x') })).toBe(false)
  })

  it('edited marcando só o UAT não analisa', () => {
    const body = section('x')
    const previousBody = body.replace('- [ ] UAT aprovado', '- [x] UAT aprovado')
    expect(shouldAnalyze({ action: 'edited', body: previousBody, previousBody: body })).toBe(false)
  })

  it('edited mudando a linha Spec: analisa', () => {
    const previousBody = section('x')
    const body = section('x', 'docs/superpowers/specs/b.md')
    expect(shouldAnalyze({ action: 'edited', body, previousBody })).toBe(true)
  })

  it('edited mudando uma célula da tabela analisa', () => {
    expect(
      shouldAnalyze({ action: 'edited', body: section('y'), previousBody: section('x') })
    ).toBe(true)
  })

  it('CRLF vs LF na mesma seção não analisa', () => {
    const body = section('x')
    expect(
      shouldAnalyze({ action: 'edited', body: body.replace(/\n/g, '\r\n'), previousBody: body })
    ).toBe(false)
  })
})

describe('specSection', () => {
  it('inclui a linha Spec: e a seção até o próximo ##', () => {
    const body = 'intro\nSpec: a.md\n\n## Spec × código\n| a |\n\n## UAT\nx'
    const section = specSection(body)
    expect(section).toContain('Spec: a.md')
    expect(section).toContain('| a |')
    expect(section).not.toContain('UAT')
    expect(section).not.toContain('intro')
  })
})

describe('previousResult', () => {
  const gate = (result: string) => ({
    body: `${COMMENT_MARKER}\n<!-- spec-gate:result=${result} -->`,
  })

  it('lê pass e fail', () => {
    expect(previousResult([gate('fail')])).toBe('fail')
    expect(previousResult([gate('pass')])).toBe('pass')
  })

  it('null sem marcador', () => {
    expect(previousResult([{ body: 'oi' }])).toBeNull()
    expect(previousResult([])).toBeNull()
  })

  it('usa o comentário que tem o marcador entre vários', () => {
    expect(previousResult([{ body: 'oi' }, gate('fail'), { body: 'tchau' }])).toBe('fail')
  })
})

describe('buildComment', () => {
  it('começa com o marcador e carrega o resultado coerente', () => {
    const pass = buildComment({ ok: true, title: 'T', reasons: [] })
    const fail = buildComment({ ok: false, title: 'T', reasons: ['motivo'] })
    expect(pass.startsWith(COMMENT_MARKER)).toBe(true)
    expect(pass).toContain('<!-- spec-gate:result=pass -->')
    expect(fail.startsWith(COMMENT_MARKER)).toBe(true)
    expect(fail).toContain('<!-- spec-gate:result=fail -->')
    expect(fail).toContain('motivo')
  })

  it('inclui a tabela de critérios e o custo quando existem', () => {
    const body = buildComment({
      ok: true,
      title: 'T',
      reasons: [],
      verdict: verdict(),
      cost: '$0.10',
    })
    expect(body).toContain('src/a.ts')
    expect(body).toContain('tudo certo')
    expect(body).toContain('$0.10')
  })
})

describe('buildPrompt', () => {
  it('pede a seção pelo título, trata entradas como não confiáveis e delimita os três blocos', () => {
    const prompt = buildPrompt({ spec: 'SPEC_X', diff: 'DIFF_X', table: 'TABLE_X' })
    expect(prompt).toContain('Critérios de Aceitação')
    expect(prompt).toContain('não confiáveis')
    for (const text of ['SPEC_X', 'DIFF_X', 'TABLE_X']) expect(prompt).toContain(text)
    expect(prompt).toContain('INÍCIO SPEC')
    expect(prompt).toContain('FIM DIFF')
    expect(prompt).toContain('FIM TABELA')
  })
})

describe('VERDICT_SCHEMA', () => {
  it('exige todos os campos', () => {
    expect(VERDICT_SCHEMA.required).toEqual(['criterios', 'divergencias', 'resumo'])
    expect(VERDICT_SCHEMA.properties.criterios.items.properties.status.enum).toEqual([
      'ok',
      'parcial',
      'fora',
      'sem-teste',
    ])
  })
})

describe('workflow spec-gate.yml', () => {
  const yml = readFileSync(resolve(ROOT, '.github/workflows/spec-gate.yml'), 'utf8')

  it('é ligado por SPEC_GATE e nomeia o job', () => {
    expect(yml).toContain("if: vars.SPEC_GATE == 'on'")
    expect(yml).toMatch(/^ {4}name: Spec × código$/m)
    expect(yml).toContain('types: [opened, synchronize, reopened, edited]')
  })

  it('cancela execuções anteriores por PR', () => {
    expect(yml).toContain('cancel-in-progress: true')
    expect(yml).toContain('github.event.pull_request.number')
  })

  it('tem permissões mínimas, sem id-token', () => {
    const block = /^permissions:\n((?: {2}.+\n)+)/m.exec(yml)?.[1] ?? ''
    expect(
      block
        .trim()
        .split('\n')
        .map((line) => line.trim())
    ).toEqual(['contents: read', 'pull-requests: write'])
    expect(yml).not.toContain('id-token')
  })

  it('fixa a action por SHA de commit com comentário de versão', () => {
    expect(yml).toMatch(/anthropics\/claude-code-action@[0-9a-f]{40} # v1\.\d+\.\d+/)
  })

  it('restringe ferramentas, usa json-schema, token e modelo configurável', () => {
    expect(yml).toContain('--allowedTools Read,Grep,Glob')
    expect(yml).toContain('--json-schema')
    expect(yml).toContain('github_token: ${{ secrets.GITHUB_TOKEN }}')
    expect(yml).toContain("${{ vars.SPEC_GATE_MODEL || 'claude-sonnet-5-5' }}")
    expect(yml).not.toContain('track_progress')
  })
})
