// Resumo diário de consumo de IA: consulta o Grafana (PromQL) e faz upsert no Neon.
// Só o hub (`central: true`) executa; qualquer outro papel sai 0 sem tocar fetch nem sql.
// Falha em qualquer consulta = exit 1 e nenhuma escrita; dados vazios = exit 0 sem escrita.
// Nunca imprime segredo (token, URL do banco): mensagens de erro só têm status HTTP/nomes de variável.

import { pathToFileURL } from 'node:url'
import { papel, readAiObsConfig } from './config.mjs'
import {
  ATRIBUTO_ORIGEM,
  ATRIBUTO_PROJETO,
  METRICA_CUSTO,
  FILTRO_SESSOES,
  METRICA_SESSOES,
  METRICA_TOKENS,
} from './metricas.mjs'

const ORIGENS = new Set(['local', 'ci'])
const MODELO_SESSOES = '*'
const SEGREDOS = ['GRAFANA_API_URL', 'GRAFANA_READ_TOKEN', 'AI_OBS_DATABASE_URL']

// Valores do atributo `type` de claude_code.token.usage, conforme a doc oficial
// (https://code.claude.com/docs/en/monitoring-usage.md): "input", "output", "cacheRead",
// "cacheCreation" ("input" exclui tokens de cache). O atributo de modelo é `model`.
const COLUNA_TOKEN = {
  input: 'tokens_entrada',
  output: 'tokens_saida',
  cacheRead: 'tokens_cache_leitura',
  cacheCreation: 'tokens_cache_escrita',
}
const ATRIBUTO_MODELO = 'model'
const ATRIBUTO_TIPO = 'type'

class ErroConsumo extends Error {}

const rotulos = (...nomes) => nomes.join(', ')

/** Dia UTC anterior a `hoje`, formato YYYY-MM-DD. */
export function diaAnterior(hoje) {
  const inicio = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())
  return new Date(inicio - 86_400_000).toISOString().slice(0, 10)
}

function linhaVazia(dia, projeto, origem, modelo) {
  return {
    dia,
    projeto,
    origem,
    modelo,
    tokens_entrada: 0,
    tokens_saida: 0,
    tokens_cache_leitura: 0,
    tokens_cache_escrita: 0,
    custo_usd: 0,
    sessoes: 0,
  }
}

/**
 * Monta as linhas de `consumo_diario` do dia. `consultar(promql)` devolve `[{ metric, value }]`.
 *
 * Desvio da spec §4.6 (LogQL para sessões): as sessões vêm da métrica claude_code.session.count (PromQL).
 * Essa métrica não tem rótulo de modelo: as sessões ficam por (projeto, origem), numa linha com
 * `modelo = '*'` e custo/tokens zero (a soma de `custo_usd` segue correta). A linha `'*'` é
 * gravada mesmo sem custo/tokens quando há sessões.
 */
export async function coletarDia({ dia, consultar }) {
  const chaves = rotulos(ATRIBUTO_PROJETO, ATRIBUTO_ORIGEM)
  const [custo, tokens, sessoes] = await Promise.all([
    consultar(`sum by (${chaves}, ${ATRIBUTO_MODELO}) (increase(${METRICA_CUSTO}[1d]))`),
    consultar(
      `sum by (${chaves}, ${ATRIBUTO_MODELO}, ${ATRIBUTO_TIPO}) (increase(${METRICA_TOKENS}[1d]))`
    ),
    consultar(`sum by (${chaves}) (increase(${METRICA_SESSOES}${FILTRO_SESSOES}[1d]))`),
  ])

  const mapa = new Map()
  const obter = (metric, modelo) => {
    const projeto = metric[ATRIBUTO_PROJETO]
    const origem = metric[ATRIBUTO_ORIGEM]
    if (!projeto || !ORIGENS.has(origem) || !modelo) return null
    const chave = [projeto, origem, modelo].join('\u0000')
    if (!mapa.has(chave)) mapa.set(chave, linhaVazia(dia, projeto, origem, modelo))
    return mapa.get(chave)
  }

  for (const s of custo) {
    const linha = obter(s.metric, s.metric[ATRIBUTO_MODELO])
    if (linha) linha.custo_usd += s.value
  }
  for (const s of tokens) {
    const coluna = COLUNA_TOKEN[s.metric[ATRIBUTO_TIPO]]
    const linha = coluna ? obter(s.metric, s.metric[ATRIBUTO_MODELO]) : null
    if (linha) linha[coluna] += s.value
  }
  for (const s of sessoes) {
    const linha = obter(s.metric, MODELO_SESSOES)
    if (linha) linha.sessoes += s.value
  }

  return [...mapa.values()]
    .map((l) => ({
      ...l,
      tokens_entrada: Math.round(l.tokens_entrada),
      tokens_saida: Math.round(l.tokens_saida),
      tokens_cache_leitura: Math.round(l.tokens_cache_leitura),
      tokens_cache_escrita: Math.round(l.tokens_cache_escrita),
      custo_usd: Math.round(l.custo_usd * 10_000) / 10_000,
      sessoes: Math.round(l.sessoes),
    }))
    .filter(
      (l) =>
        l.custo_usd > 0 ||
        l.sessoes > 0 ||
        l.tokens_entrada + l.tokens_saida + l.tokens_cache_leitura + l.tokens_cache_escrita > 0
    )
}

/**
 * Upsert atômico: um único INSERT multi-linha (via unnest) com ON CONFLICT, então uma falha
 * não deixa o dia parcialmente gravado.
 */
export async function gravar(sql, linhas) {
  if (linhas.length === 0) return
  const col = (nome) => linhas.map((l) => l[nome])
  await sql`
    insert into consumo_diario (
      dia, projeto, origem, modelo, tokens_entrada, tokens_saida,
      tokens_cache_leitura, tokens_cache_escrita, custo_usd, sessoes
    )
    select * from unnest(
      ${col('dia')}::date[], ${col('projeto')}::text[], ${col('origem')}::text[],
      ${col('modelo')}::text[], ${col('tokens_entrada')}::bigint[], ${col('tokens_saida')}::bigint[],
      ${col('tokens_cache_leitura')}::bigint[], ${col('tokens_cache_escrita')}::bigint[],
      ${col('custo_usd')}::numeric[], ${col('sessoes')}::integer[]
    )
    on conflict (dia, projeto, origem, modelo) do update set
      tokens_entrada = excluded.tokens_entrada,
      tokens_saida = excluded.tokens_saida,
      tokens_cache_leitura = excluded.tokens_cache_leitura,
      tokens_cache_escrita = excluded.tokens_cache_escrita,
      custo_usd = excluded.custo_usd,
      sessoes = excluded.sessoes,
      coletado_em = now()
  `
}

/** Consulta instantânea da API HTTP do Prometheus (Grafana Cloud) no instante `time`. */
function criarConsultar({ env, fetch, time }) {
  const base = env.GRAFANA_API_URL.replace(/\/+$/, '')
  return async (promql) => {
    const url = `${base}/api/v1/query?${new globalThis.URLSearchParams({ query: promql, time: String(time) })}`
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${env.GRAFANA_READ_TOKEN}` },
    })
    if (!resp.ok) throw new ErroConsumo(`Grafana respondeu HTTP ${resp.status}`)
    const corpo = await resp.json()
    if (corpo?.status !== 'success') throw new ErroConsumo('Grafana: status diferente de success')
    return (corpo.data?.result ?? []).map((r) => ({
      metric: r.metric ?? {},
      value: Number(r.value?.[1]),
    }))
  }
}

/**
 * @returns {Promise<number>} exit code
 * @param {{ env: any, cfg: any, fetch: any, sql: any, hoje?: Date, consultar?: any }} args
 * `consultar` é um ponto de injeção para testes; por padrão usa `fetch` + env.
 */
export async function main({ env, cfg, fetch, sql, hoje = new Date(), consultar }) {
  if (papel(cfg) !== 'hub') return 0

  const faltando = SEGREDOS.filter((nome) => !env[nome])
  if (faltando.length > 0) {
    console.error(`ai-consumo-diario: variáveis ausentes: ${faltando.join(', ')}`)
    return 1
  }

  const dia = diaAnterior(hoje)
  const time = Date.parse(`${dia}T00:00:00Z`) / 1000 + 86_400
  try {
    const linhas = await coletarDia({
      dia,
      consultar: consultar ?? criarConsultar({ env, fetch, time }),
    })
    if (linhas.length === 0) {
      console.log(`ai-consumo-diario: sem consumo em ${dia}, nada gravado`)
      return 0
    }
    await gravar(sql, linhas)
    console.log(`ai-consumo-diario: ${linhas.length} linha(s) gravada(s) para ${dia}`)
    return 0
  } catch (e) {
    const motivo = e instanceof ErroConsumo ? e.message : 'falha inesperada na coleta ou gravação'
    console.error(`ai-consumo-diario: ${motivo}`)
    return 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let code = 1
  try {
    const cfg = readAiObsConfig()
    let sql = null
    if (papel(cfg) === 'hub' && process.env.AI_OBS_DATABASE_URL) {
      const { neon } = await import('@neondatabase/serverless')
      sql = neon(process.env.AI_OBS_DATABASE_URL)
    }
    code = await main({ env: process.env, cfg, fetch: globalThis.fetch, sql, hoje: new Date() })
  } catch (e) {
    console.error(
      `ai-consumo-diario: falha inesperada (detalhes omitidos para não expor segredos) [${e instanceof Error ? e.name : 'erro'}]`
    )
  }
  process.exit(code)
}
