import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { main } from '../../scripts/ai-bom.mjs'
import { parseAiObsConfig } from '../../scripts/ai-observabilidade/config.mjs'
import { escaparLabel, regrasAlerta } from '../../scripts/ai-observabilidade/grafana.mjs'
import {
  METRICA_CUSTO,
  METRICA_SESSOES,
  METRICA_TOKENS,
  ATRIBUTO_ORIGEM,
  ATRIBUTO_PROJETO,
} from '../../scripts/ai-observabilidade/metricas.mjs'

type Regra = {
  uid: string
  annotations: { description: string }
  data: { model: { expr?: string; conditions?: { evaluator: { params: number[] } }[] } }[]
}

function regras(raw: unknown): Regra[] {
  return regrasAlerta(parseAiObsConfig(raw)).groups[0].rules
}
const limite = (r: Regra) => r.data[2].model.conditions?.[0].evaluator.params[0]
const achar = (rs: Regra[], uid: string) => rs.find((r) => r.uid === uid)

describe('regras de alerta do Grafana', () => {
  it('CT-AIBOM-007 teto 400 / aviso 80 gera teto-total-aviso (320) e teto-total-alarme (400)', () => {
    const doc = regrasAlerta(parseAiObsConfig({ ativo: true, projeto: 'P', central: true }))
    expect(doc.apiVersion).toBe(1)
    expect(doc.groups[0].name).toBe('ai-teto')
    const rs = doc.groups[0].rules as Regra[]
    expect(limite(achar(rs, 'teto-total-aviso') as Regra)).toBe(320)
    expect(limite(achar(rs, 'teto-total-alarme') as Regra)).toBe(400)
    const r = achar(rs, 'teto-total-aviso') as Regra
    expect(r.data[0].model.expr).toBe(`sum(increase(${METRICA_CUSTO}[30d]))`)
    expect(r.annotations.description).toContain('janela móvel de 30 dias')
  })

  it('CT-AIBOM-007 porProjetoUsd gera regras por projeto com filtro e limiares próprios', () => {
    const rs = regras({
      ativo: true,
      projeto: 'P',
      central: true,
      teto: { porProjetoUsd: { 'AssistBru.ai': 100 } },
    })
    const aviso = achar(rs, 'teto-AssistBru.ai-aviso') as Regra
    expect(limite(aviso)).toBe(80)
    expect(limite(achar(rs, 'teto-AssistBru.ai-alarme') as Regra)).toBe(100)
    expect(aviso.data[0].model.expr).toContain('projeto="AssistBru.ai"')
  })

  it('CT-AIBOM-007 escapa aspas e barras no valor do label', () => {
    expect(escaparLabel('a"b\\c')).toBe('a\\"b\\\\c')
  })
})

describe('painel.json', () => {
  const texto = readFileSync('observabilidade/grafana/painel.json', 'utf8')
  const painel = JSON.parse(texto)
  const exprs: string[] = painel.panels.flatMap((p: { targets: { expr: string }[] }) =>
    p.targets.map((t) => t.expr)
  )

  it('CT-AIBOM-007 usa exatamente os nomes de metricas.mjs', () => {
    for (const nome of [METRICA_CUSTO, METRICA_TOKENS, METRICA_SESSOES]) {
      expect(texto).toContain(nome)
    }
    const usadas = texto.match(/claude_code_[a-zA-Z_]+/g) ?? []
    for (const nome of usadas) {
      expect([METRICA_CUSTO, METRICA_TOKENS, METRICA_SESSOES]).toContain(nome)
    }
  })

  it('CT-AIBOM-007 agrupa pelos rótulos ATRIBUTO_PROJETO e ATRIBUTO_ORIGEM', () => {
    expect(exprs.some((e) => e.includes(`by (${ATRIBUTO_PROJETO})`))).toBe(true)
    expect(exprs.some((e) => e.includes(`by (${ATRIBUTO_ORIGEM})`))).toBe(true)
    const rotulos = [...texto.matchAll(/by \(([^)]*)\)/g)].flatMap((m) => m[1].split(/,\s*/))
    for (const r of rotulos) {
      expect([ATRIBUTO_PROJETO, ATRIBUTO_ORIGEM, 'model', 'type']).toContain(r)
    }
  })

  it('CT-AIBOM-007 não fixa o teto: nenhum threshold numérico no painel', () => {
    const cfg = parseAiObsConfig({ ativo: true, projeto: 'P', central: true })
    expect(texto).not.toContain('thresholds')
    expect(texto).not.toMatch(new RegExp(`\\b${cfg.teto.mensalUsd}\\b`))
  })
})

function deps(config: unknown) {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    deps: {
      cwd: '/p',
      readFile: (p: string) =>
        p === 'ai-observabilidade.config.json' && config !== null ? JSON.stringify(config) : null,
      writeFile: () => undefined,
      list: () => [],
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
    },
  }
}

describe('CLI --grafana', () => {
  it.each([
    ['emissor', { ativo: true, projeto: 'P' }],
    ['desligado', { ativo: false }],
    ['ausente', null],
  ])('CT-AIBOM-006 %s → exit 0, stdout vazio, avisa que só o hub gera', async (_n, cfg) => {
    const d = deps(cfg)
    expect(await main(['--grafana'], d.deps)).toBe(0)
    expect(d.out).toEqual([])
    expect(d.err.join('')).toContain('só o hub (central: true) gera alertas')
  })

  it('CT-AIBOM-007 hub imprime JSON das regras no stdout', async () => {
    const d = deps({ ativo: true, projeto: 'P', central: true })
    expect(await main(['--grafana'], d.deps)).toBe(0)
    expect(JSON.parse(d.out.join('')).groups[0].name).toBe('ai-teto')
  })
})
