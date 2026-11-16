// Adaptador Heroku: o deploy é pela integração git do próprio Heroku (Review Apps / pipeline),
// então preview/prod/encerrar são no-op. Só a espera do review app usa a Platform API.
// O nome do ambiente de preview não é documentado: o filtro do GitHub nunca casa.

import { setTimeout as esperar } from 'node:timers/promises'
import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from '../aguardar.mjs'

const API = 'https://api.heroku.com'

const noop = async () => {}

const minutos = (ms) => `${Math.round(ms / 60_000)} min`

const erroHttp = (status, caminho) =>
  Object.assign(new Error(`HTTP ${status} em ${caminho}`), { status })

const transitorio = (error) =>
  typeof error?.status === 'number' && (error.status >= 500 || error.status === 429)

const maisRecente = (a, b) => String(a.created_at).localeCompare(String(b.created_at))

const fazerGet =
  ({ token, fetchFn }) =>
  async (caminho) => {
    const headers = {
      Accept: 'application/vnd.heroku+json; version=3',
      Authorization: `Bearer ${token}`,
    }
    const resposta = await fetchFn(`${API}${caminho}`, { headers })
    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error(
        `Heroku recusou as credenciais (HTTP ${resposta.status}): verifique HEROKU_API_KEY`
      )
    }
    if (!resposta.ok) throw erroHttp(resposta.status, caminho)
    return resposta.json()
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

  const prazo = now() + timeoutMs
  let viuReviewApp = false
  let ultimoErro = ''

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

  for (;;) {
    try {
      const pronto = await consultar()
      if (pronto) return pronto
    } catch (error) {
      if (!transitorio(error)) throw error
      ultimoErro = ` (último erro da API: ${error.message})`
    }
    if (now() >= prazo) {
      throw new Error(
        (viuReviewApp
          ? `Review app para ${sha} não ficou pronto em ${minutos(timeoutMs)}`
          : `Nenhum review app para ${sha} em ${minutos(timeoutMs)}`) + ultimoErro
      )
    }
    await sleep(Math.min(intervalMs, Math.max(prazo - now(), 0)))
  }
}

export default {
  nome: 'heroku',
  ambienteDePreview: () => false,
  deployPreview: noop,
  deployProd: noop,
  encerrarPreview: noop,
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
