import { describe, it, expect, vi } from 'vitest'
import { coletarDia, gravar, main } from '../../scripts/ai-observabilidade/consumoDiario.mjs'
import { parseAiObsConfig } from '../../scripts/ai-observabilidade/config.mjs'
import {
  METRICA_CUSTO,
  FILTRO_SESSOES,
  METRICA_SESSOES,
  METRICA_TOKENS,
} from '../../scripts/ai-observabilidade/metricas.mjs'

type Serie = { metric: Record<string, string>; value: number }
type Linha = Record<string, string | number>

const HOJE = new Date('2026-11-27T03:00:00Z')
const hub = parseAiObsConfig({ ativo: true, projeto: 'AssistBru.ai', central: true })
const emissor = parseAiObsConfig({ ativo: true, projeto: 'AssistBru.ai' })
const env = {
  GRAFANA_API_URL: 'https://prom.example',
  GRAFANA_READ_TOKEN: 'tok-secreto',
  AI_OBS_DATABASE_URL: 'postgres://u:senha-secreta@h/db',
}
const base = { projeto: 'AssistBru.ai', origem: 'local' }
const MODELO = 'claude-opus-5-5'

function consultarFake(sessoes = 3): (q: string) => Promise<Serie[]> {
  return async (q) => {
    if (q.includes(METRICA_CUSTO)) return [{ metric: { ...base, model: MODELO }, value: 1.5 }]
    if (q.includes(METRICA_TOKENS)) {
      return [
        { metric: { ...base, model: MODELO, type: 'input' }, value: 100.4 },
        { metric: { ...base, model: MODELO, type: 'output' }, value: 50 },
        { metric: { ...base, model: MODELO, type: 'cacheRead' }, value: 7 },
        { metric: { ...base, model: MODELO, type: 'cacheCreation' }, value: 9 },
      ]
    }
    return sessoes ? [{ metric: base, value: sessoes }] : []
  }
}

/** sql fake em memória: impõe a chave primária (dia, projeto, origem, modelo) e o all-or-nothing. */
function sqlFake() {
  const tabela = new Map<string, Linha>()
  const chamadas: string[] = []
  const sql = async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const texto = strings.join('?')
    chamadas.push(texto)
    expect(texto).toMatch(/on conflict \(dia, projeto, origem, modelo\) do update/i)
    const [dias, projetos, origens, modelos, ent, sai, cl, ce, custo, sessoes] = valores as (
      string[] | number[]
    )[]
    const lote = new Map<string, Linha>()
    dias.forEach((_, i) => {
      const k = [dias[i], projetos[i], origens[i], modelos[i]].join('|')
      if (lote.has(k))
        throw new Error('ON CONFLICT DO UPDATE command cannot affect row a second time')
      lote.set(k, {
        dia: dias[i],
        projeto: projetos[i],
        origem: origens[i],
        modelo: modelos[i],
        tokens_entrada: ent[i],
        tokens_saida: sai[i],
        tokens_cache_leitura: cl[i],
        tokens_cache_escrita: ce[i],
        custo_usd: custo[i],
        sessoes: sessoes[i],
      })
    })
    for (const [k, v] of lote) tabela.set(k, v)
    return []
  }
  return { sql, tabela, chamadas }
}

describe('coletarDia', () => {
  it('CT-AIBOM-008 mapeia tipos de token, arredonda e põe sessões na linha modelo "*"', async () => {
    const linhas = (await coletarDia({ dia: '2026-11-26', consultar: consultarFake() })) as Linha[]
    expect(linhas).toHaveLength(2)
    expect(linhas.find((l) => l.modelo === MODELO)).toMatchObject({
      dia: '2026-11-26',
      projeto: 'AssistBru.ai',
      origem: 'local',
      tokens_entrada: 100,
      tokens_saida: 50,
      tokens_cache_leitura: 7,
      tokens_cache_escrita: 9,
      custo_usd: 1.5,
      sessoes: 0,
    })
    expect(linhas.find((l) => l.modelo === '*')).toMatchObject({
      custo_usd: 0,
      tokens_entrada: 0,
      sessoes: 3,
    })
  })

  it('CT-AIBOM-008 consulta o dia com as três queries PromQL de 1d', async () => {
    const consultar = vi.fn(consultarFake())
    await coletarDia({ dia: '2026-11-26', consultar })
    const qs = consultar.mock.calls.map((c) => c[0])
    expect(qs).toHaveLength(3)
    expect(qs[0]).toBe(`sum by (projeto, origem, model) (increase(${METRICA_CUSTO}[1d]))`)
    expect(qs[1]).toBe(`sum by (projeto, origem, model, type) (increase(${METRICA_TOKENS}[1d]))`)
    expect(qs[2]).toBe(
      `sum by (projeto, origem) (increase(${METRICA_SESSOES}${FILTRO_SESSOES}[1d]))`
    )
  })

  it('CT-AIBOM-008 grava a linha "*" mesmo sem custo nem tokens se há sessões', async () => {
    const consultar = async (q: string) =>
      q.includes(METRICA_SESSOES) ? [{ metric: base, value: 2 }] : []
    const linhas = (await coletarDia({ dia: '2026-11-26', consultar })) as Linha[]
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({ modelo: '*', sessoes: 2 })
  })

  it('CT-AIBOM-008 ignora séries com origem fora de local/ci', async () => {
    const consultar = async (q: string) =>
      q.includes(METRICA_CUSTO)
        ? [{ metric: { projeto: 'X', origem: 'outra', model: MODELO }, value: 1 }]
        : []
    expect(await coletarDia({ dia: '2026-11-26', consultar })).toEqual([])
  })
})

describe('main', () => {
  it('CT-AIBOM-008 rodar duas vezes grava uma única linha por dia/projeto/origem/modelo', async () => {
    const { sql, tabela } = sqlFake()
    const fetchMock = vi.fn()
    const sobrescrever = { consultar: consultarFake() }
    for (let i = 0; i < 2; i++) {
      expect(
        await main({ env, cfg: hub, fetch: fetchMock, sql, hoje: HOJE, ...sobrescrever })
      ).toBe(0)
    }
    expect(tabela.size).toBe(2)
    const linha = tabela.get(`2026-11-26|AssistBru.ai|local|${MODELO}`)
    expect(linha?.custo_usd).toBe(1.5)
  })

  it('CT-AIBOM-008 consulta o Grafana via HTTP com bearer e time = início do dia de hoje', async () => {
    const { sql, tabela } = sqlFake()
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      expect(init.headers.Authorization).toBe('Bearer tok-secreto')
      const u = new URL(url)
      expect(u.origin + u.pathname).toBe('https://prom.example/api/v1/query')
      expect(u.searchParams.get('time')).toBe(String(Date.parse('2026-11-27T00:00:00Z') / 1000))
      const q = u.searchParams.get('query') ?? ''
      const v = q.includes(METRICA_CUSTO) ? '1.23456' : '10'
      const metric = q.includes(METRICA_SESSOES)
        ? base
        : q.includes(METRICA_TOKENS)
          ? { ...base, model: MODELO, type: 'input' }
          : { ...base, model: MODELO }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'vector', result: [{ metric, value: [1, v] }] },
        }),
      }
    })
    expect(await main({ env, cfg: hub, fetch: fetchMock, sql, hoje: HOJE })).toBe(0)
    expect(tabela.get(`2026-11-26|AssistBru.ai|local|${MODELO}`)?.custo_usd).toBe(1.2346)
    expect(tabela.get(`2026-11-26|AssistBru.ai|local|*`)?.sessoes).toBe(10)
  })

  it('CT-AIBOM-006 emissor com os segredos presentes sai 0 sem chamar fetch nem sql', async () => {
    const fetchMock = vi.fn()
    const sql = vi.fn()
    expect(await main({ env, cfg: emissor, fetch: fetchMock, sql, hoje: HOJE })).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sql).not.toHaveBeenCalled()
  })

  it('CT-AIBOM-006 config ausente (desligado) sai 0 sem chamar fetch nem sql', async () => {
    const fetchMock = vi.fn()
    const sql = vi.fn()
    expect(
      await main({ env, cfg: parseAiObsConfig(null), fetch: fetchMock, sql, hoje: HOJE })
    ).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sql).not.toHaveBeenCalled()
  })

  it('CT-AIBOM-008 séries vazias: nenhuma escrita e exit 0', async () => {
    const sql = vi.fn()
    const code = await main({
      env,
      cfg: hub,
      fetch: vi.fn(),
      sql,
      hoje: HOJE,
      consultar: async () => [],
    })
    expect(code).toBe(0)
    expect(sql).not.toHaveBeenCalled()
  })

  it('CT-AIBOM-008 HTTP 500 numa consulta: exit 1, nada escrito e sem vazar segredos', async () => {
    const sql = vi.fn()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    expect(await main({ env, cfg: hub, fetch: fetchMock, sql, hoje: HOJE })).toBe(1)
    expect(sql).not.toHaveBeenCalled()
    const saida = err.mock.calls.flat().join(' ')
    expect(saida).not.toContain('tok-secreto')
    expect(saida).not.toContain('senha-secreta')
    err.mockRestore()
  })

  it('CT-AIBOM-008 status diferente de success: exit 1 e nada escrito', async () => {
    const sql = vi.fn()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'error' }),
    }))
    expect(await main({ env, cfg: hub, fetch: fetchMock, sql, hoje: HOJE })).toBe(1)
    expect(sql).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('CT-AIBOM-008 falha na gravação propaga como exit 1 sem linha parcial', async () => {
    const { tabela } = sqlFake()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ruim = async () => {
      throw new Error('falha')
    }
    expect(
      await main({
        env,
        cfg: hub,
        fetch: vi.fn(),
        sql: ruim,
        hoje: HOJE,
        consultar: consultarFake(),
      })
    ).toBe(1)
    expect(tabela.size).toBe(0)
    err.mockRestore()
  })

  it('CT-AIBOM-008 hub sem segredos sai 1 com mensagem clara', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sql = vi.fn()
    expect(await main({ env: {}, cfg: hub, fetch: vi.fn(), sql, hoje: HOJE })).toBe(1)
    expect(err.mock.calls.flat().join(' ')).toContain('GRAFANA_READ_TOKEN')
    err.mockRestore()
  })
})

describe('gravar', () => {
  it('CT-AIBOM-008 não chama o sql sem linhas', async () => {
    const sql = vi.fn()
    await gravar(sql, [])
    expect(sql).not.toHaveBeenCalled()
  })
})
