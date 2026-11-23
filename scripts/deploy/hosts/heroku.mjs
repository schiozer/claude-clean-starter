// Adaptador Heroku: o deploy de PR é pela integração git do próprio Heroku (Review Apps), então
// preview/encerrar são no-op e só a espera do review app usa a Platform API. O nome do ambiente
// de preview não é documentado: o filtro do GitHub nunca casa.
// Com a esteira (spec esteira-build-once-promote §5.6), o UAT fixo (`heroku.uatApp`) recebe um build
// do tarball do SHA e Prod (`heroku.prodApp`) recebe **o mesmo slug** por pipeline promotion.
// Escrita usa `HEROKU_DEPLOY_API_KEY`; `HEROKU_API_KEY` segue só de leitura. A URL do tarball é
// temporária e autenticada: nunca vai para log nem para mensagem de erro.

import { setTimeout as esperar } from 'node:timers/promises'
import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from '../aguardar.mjs'
import { antesDeMudarProd } from '../prodIntocada.mjs'

const API = 'https://api.heroku.com'

const noop = async () => {}

const minutos = (ms) => `${Math.round(ms / 60_000)} min`

const erroHttp = (status, caminho) =>
  Object.assign(new Error(`HTTP ${status} em ${caminho}`), { status })

const transitorio = (error) =>
  typeof error?.status === 'number' && (error.status >= 500 || error.status === 429)

const maisRecente = (a, b) => String(a.created_at).localeCompare(String(b.created_at))

/**
 * Platform API: `(metodo, caminho, corpo?, headersExtras?) → JSON`. O token nunca entra em
 * mensagens de erro.
 */
const fazerApi =
  ({ token, fetchFn, variavel = 'HEROKU_API_KEY' }) =>
  async (metodo, caminho, corpo, headersExtras = {}) => {
    const headers = {
      Accept: 'application/vnd.heroku+json; version=3',
      Authorization: `Bearer ${token}`,
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      ...headersExtras,
    }
    const resposta = await fetchFn(`${API}${caminho}`, {
      method: metodo,
      headers,
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    })
    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error(
        `Heroku recusou as credenciais (HTTP ${resposta.status}): verifique ${variavel}`
      )
    }
    if (!resposta.ok) throw erroHttp(resposta.status, caminho)
    return resposta.json()
  }

const fazerGet = (opcoes) => {
  const api = fazerApi(opcoes)
  return (caminho) => api('GET', caminho)
}

/**
 * Polling até `consultar()` devolver algo (lança se falhou). Erros transitórios (5xx/429) tentam
 * de novo até o prazo; no timeout lança `mensagemDeTimeout()` + o último erro da API.
 */
async function sondar({ consultar, mensagemDeTimeout, now, sleep, timeoutMs, intervalMs }) {
  const prazo = now() + timeoutMs
  let ultimoErro = ''
  for (;;) {
    try {
      const pronto = await consultar()
      if (pronto) return pronto
    } catch (error) {
      if (!transitorio(error)) throw error
      ultimoErro = ` (último erro da API: ${error.message})`
    }
    if (now() >= prazo) throw new Error(mensagemDeTimeout() + ultimoErro)
    await sleep(Math.min(intervalMs, Math.max(prazo - now(), 0)))
  }
}

/**
 * `web_url` do review app mais novo do PR, ou null se não há review app (ou o app já sumiu).
 * Usado para tirar a URL do Auth0 ao encerrar o PR.
 * @returns {Promise<string | null>}
 */
export async function urlDoReviewApp({ pr, pipelineId, token, fetchFn = globalThis.fetch }) {
  const get = fazerGet({ token, fetchFn })
  const apps = await get(`/pipelines/${encodeURIComponent(pipelineId)}/review-apps`)
  const revApp = (apps ?? [])
    .filter((a) => a.pr_number === pr)
    .sort(maisRecente)
    .at(-1)
  const appId = revApp?.app?.id
  if (!appId || revApp.status === 'deleted') return null
  try {
    const app = await get(`/apps/${encodeURIComponent(appId)}`)
    return app?.web_url || null
  } catch (error) {
    if (error?.status === 404) return null
    throw error
  }
}

/**
 * Espera o review app do PR (`pr_number === pr`) ter um build `succeeded` do commit `sha` e devolve
 * a `web_url`. O review app não tem campo `commit`; o SHA vem do build mais novo do app:
 * `source_blob.version` é como a integração GitHub do Heroku rotula o commit (premissa, a
 * confirmar no CA-10). O token nunca entra em mensagens de erro nem em log.
 * @returns {Promise<{ url: string }>}
 */
export async function aguardarReviewApp({
  sha,
  pr,
  pipelineId,
  token,
  fetchFn = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => esperar(ms),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
}) {
  const get = fazerGet({ token, fetchFn })
  let viuReviewApp = false

  const consultar = async () => {
    const apps = await get(`/pipelines/${encodeURIComponent(pipelineId)}/review-apps`)
    const revApp = (apps ?? [])
      .filter((a) => a.pr_number === pr)
      .sort(maisRecente)
      .at(-1)
    if (!revApp) return null
    viuReviewApp = true
    if (revApp.status === 'errored') {
      const detalhe = [revApp.message, revApp.error_status].filter(Boolean).join(' - ')
      throw new Error(`Review app do PR #${pr} falhou (errored)${detalhe ? `: ${detalhe}` : ''}`)
    }
    if (revApp.status === 'deleting' || revApp.status === 'deleted') {
      throw new Error(`Review app do PR #${pr} foi removido (${revApp.status}): o PR foi fechado?`)
    }
    if (revApp.status !== 'created') return null
    const appId = revApp.app?.id
    if (!appId) throw new Error(`Review app do PR #${pr} criado sem app (sem app.id)`)

    const builds = await get(`/apps/${encodeURIComponent(appId)}/builds`)
    const build = (builds ?? []).sort(maisRecente).at(-1)
    if (!build || build.source_blob?.version !== sha) return null
    if (build.status === 'failed') {
      throw new Error(`Build do review app do PR #${pr} falhou para ${sha} (status: failed)`)
    }
    if (build.status !== 'succeeded') return null
    const app = await get(`/apps/${encodeURIComponent(appId)}`)
    if (!app?.web_url)
      throw new Error(`Review app sem URL para ${sha} (build succeeded sem web_url)`)
    return { url: app.web_url }
  }

  return sondar({
    consultar,
    mensagemDeTimeout: () =>
      viuReviewApp
        ? `Review app para ${sha} não ficou pronto em ${minutos(timeoutMs)}`
        : `Nenhum review app para ${sha} em ${minutos(timeoutMs)}`,
    now,
    sleep,
    timeoutMs,
    intervalMs,
  })
}

// ---------------------------------------------------------------- esteira

const curto = (sha) => String(sha).slice(0, 7)
const app = (nome) => `/apps/${encodeURIComponent(nome)}`

/**
 * URL temporária do tarball do SHA: o `Location` de `GET /repos/{repo}/tarball/{sha}` (redirect
 * manual). O Heroku baixa sem autenticação; a URL **nunca** é logada.
 * @param {{ location: (path: string) => Promise<string> }} github
 * @param {string} sha
 */
export const tarballUrl = (github, sha) => github.location(`/tarball/${encodeURIComponent(sha)}`)

/** Contexto da esteira: API de escrita (`HEROKU_DEPLOY_API_KEY`) e relógio injetáveis. */
function esteiraCtx(ctx) {
  const token = ctx.env?.HEROKU_DEPLOY_API_KEY
  if (!token) {
    throw new Error(
      'deploy: variável HEROKU_DEPLOY_API_KEY (escrita) é obrigatória para a esteira no Heroku'
    )
  }
  return {
    api: fazerApi({
      token,
      fetchFn: ctx.fetchFn ?? globalThis.fetch,
      variavel: 'HEROKU_DEPLOY_API_KEY',
    }),
    espera: {
      now: ctx.now ?? Date.now,
      sleep: ctx.sleep ?? ((ms) => esperar(ms)),
      timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      intervalMs: ctx.intervalMs ?? DEFAULT_INTERVAL_MS,
    },
  }
}

/** Build `id` do app até `succeeded` (devolve o build) ou `failed` (lança). */
function esperarBuild({ api, espera, appNome, id, sha }) {
  return sondar({
    ...espera,
    consultar: async () => {
      const build = await api('GET', `${app(appNome)}/builds/${encodeURIComponent(id)}`)
      if (build?.status === 'failed') {
        throw new Error(`Build ${id} no ${appNome} falhou para ${sha} (status: failed)`)
      }
      return build?.status === 'succeeded' ? build : null
    },
    mensagemDeTimeout: () =>
      `Build ${id} no ${appNome} para ${sha} não ficou pronto em ${minutos(espera.timeoutMs)}`,
  })
}

/** Build do tarball do SHA no app e espera `succeeded`. A URL do tarball não sai daqui. */
async function buildDoTarball(ctx, { api, espera }, appNome) {
  const url = await tarballUrl(ctx.github, ctx.sha)
  const criado = await api('POST', `${app(appNome)}/builds`, {
    source_blob: { url, version: ctx.sha },
  })
  ctx.log?.(`build ${criado.id} criado no ${appNome} para ${curto(ctx.sha)}`)
  const build = await esperarBuild({ api, espera, appNome, id: criado.id, sha: ctx.sha })
  ctx.log?.(`build ${criado.id} no ${appNome} pronto (succeeded)`)
  return build
}

async function webUrl(get, appNome) {
  const dados = await get(app(appNome))
  if (!dados?.web_url) throw new Error(`deploy: app ${appNome} sem web_url`)
  return dados.web_url
}

/**
 * Sem `Range`, a Platform API lista em ordem ascendente e corta em 200: as releases recentes
 * sumiriam. Pede as 50 mais novas (desc) e reordena por segurança.
 */
const RANGE_RELEASES_DESC = 'version ..; order=desc, max=50'

const releasesPorVersao = async (api, appNome) =>
  [
    ...((await api('GET', `${app(appNome)}/releases`, undefined, {
      Range: RANGE_RELEASES_DESC,
    })) ?? []),
  ].sort((a, b) => b.version - a.version)

/** Release em produção no app: a `current` ou, sem ela, a `succeeded` de maior versão. */
const releaseAtual = (releases) =>
  releases.find((r) => r.current) ?? releases.find((r) => r.status === 'succeeded')

/** @param {{ config: any, sha: string, github: any, log?: (msg: string) => void, env: any, fetchFn?: typeof fetch }} ctx */
async function deployUat(ctx) {
  const esteira = esteiraCtx(ctx)
  const { uatApp } = ctx.config.heroku
  const build = await buildDoTarball(ctx, esteira, uatApp)
  const slug = build.slug?.id
  if (!slug) throw new Error(`deploy: build ${build.id} no ${uatApp} sem slug`)
  return { url: await webUrl((c) => esteira.api('GET', c), uatApp), payload: { slug } }
}

async function urlUat(ctx) {
  const token = ctx.env?.HEROKU_API_KEY ?? ctx.env?.HEROKU_DEPLOY_API_KEY
  if (!token) throw new Error('deploy: variável HEROKU_API_KEY é obrigatória para o Heroku')
  const get = fazerGet({ token, fetchFn: ctx.fetchFn ?? globalThis.fetch })
  return webUrl(get, ctx.config.heroku.uatApp)
}

/** UUID do app: o corpo de `/pipeline-promotions` só aceita id, não nome. */
const idDoApp = async (api, appNome) => {
  const dados = await api('GET', app(appNome))
  if (!dados?.id) throw new Error(`deploy: app ${appNome} sem id na Platform API`)
  return dados.id
}

/**
 * Promove o slug do UAT para Prod. CT-ESTEIRA-010: só se o slug da release atual do UAT é do SHA
 * pedido (`slug.commit`). A promoção copia a release atual do UAT no momento do POST; por isso, ao
 * terminar, confere que Prod ficou com o slug verificado (UAT pode ter mudado no meio).
 */
async function promoverProd(ctx) {
  const { pipelineId, uatApp, prodApp } = ctx.config.heroku
  // Até o POST da promoção nada mudou em Prod: falha aqui não pede rollback.
  const { api, espera, slug, uatId, prodId } = await antesDeMudarProd(async () => {
    const { api, espera } = esteiraCtx(ctx)
    const slug = releaseAtual(await releasesPorVersao(api, uatApp))?.slug?.id
    const dadosDoSlug = slug
      ? await api('GET', `${app(uatApp)}/slugs/${encodeURIComponent(slug)}`)
      : undefined
    if (!dadosDoSlug || dadosDoSlug.commit !== ctx.sha) {
      throw new Error(`deploy: slug do UAT não é de ${curto(ctx.sha)}: rode o deploy de UAT do SHA`)
    }
    const [uatId, prodId] = [await idDoApp(api, uatApp), await idDoApp(api, prodApp)]
    return { api, espera, slug, uatId, prodId }
  })

  const promocao = await api('POST', '/pipeline-promotions', {
    pipeline: { id: pipelineId },
    source: { app: { id: uatId } },
    targets: [{ app: { id: prodId } }],
  })
  ctx.log?.(`promoção ${promocao.id}: slug de ${curto(ctx.sha)} do ${uatApp} para o ${prodApp}`)
  await sondar({
    ...espera,
    consultar: async () => {
      const alvos = await api(
        'GET',
        `/pipeline-promotions/${encodeURIComponent(promocao.id)}/promotion-targets`
      )
      const alvo = (alvos ?? [])[0]
      if (alvo?.status === 'failed') {
        const detalhe = alvo.error_message ? `: ${alvo.error_message}` : ''
        throw new Error(`Promoção para o ${prodApp} falhou (status: failed)${detalhe}`)
      }
      return alvo?.status === 'succeeded'
    },
    mensagemDeTimeout: () =>
      `Promoção para o ${prodApp} não terminou em ${minutos(espera.timeoutMs)}`,
  })

  const emProd = releaseAtual(await releasesPorVersao(api, prodApp))?.slug?.id
  if (emProd !== slug) {
    throw new Error(
      `deploy: prod recebeu slug diferente do verificado — UAT mudou durante a promoção; ` +
        'faça rollback e promova de novo'
    )
  }
  ctx.log?.(`promoção ${promocao.id} concluída (succeeded)`)
  return { payload: { slug } }
}

/** Volta Prod para o slug da release `succeeded` anterior (de slug diferente) à atual. */
async function rollbackProd(ctx) {
  const { api } = esteiraCtx(ctx)
  const { prodApp } = ctx.config.heroku
  const releases = await releasesPorVersao(api, prodApp)
  const atual = releaseAtual(releases)
  const anterior = releases.find(
    (r) =>
      r.status === 'succeeded' &&
      r.slug?.id &&
      r.version < (atual?.version ?? Infinity) &&
      r.slug.id !== atual?.slug?.id
  )
  if (!anterior) throw new Error(`deploy: ${prodApp} sem release anterior para o rollback`)
  await api('POST', `${app(prodApp)}/releases`, { slug: anterior.slug.id })
  ctx.log?.(`rollback do ${prodApp} para a release v${anterior.version}`)
}

/** Hotfix: build do tarball do SHA direto no `prodApp`. Sem `prodApp` (sem esteira): no-op. */
async function deployProd(ctx) {
  const prodApp = ctx.config?.heroku?.prodApp
  if (!prodApp) return
  await buildDoTarball(ctx, esteiraCtx(ctx), prodApp)
}

export default {
  nome: 'heroku',
  promoveAposFF: false,
  ambienteDePreview: () => false,
  deployPreview: noop,
  deployProd,
  encerrarPreview: noop,
  deployUat,
  urlUat,
  promoverProd,
  rollbackProd,
  async aguardarPreview(ctx) {
    const token = ctx.env?.HEROKU_API_KEY
    if (!token) throw new Error('deploy: variável HEROKU_API_KEY é obrigatória para o Heroku')
    const { url } = await aguardarReviewApp({
      sha: ctx.sha,
      pr: ctx.pr,
      pipelineId: ctx.config.heroku.pipelineId,
      token,
    })
    return url
  },
}
