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

/**
 * Espera o review app do PR (`commit === sha`) ficar `created` e devolve a `web_url`.
 * O token nunca entra em mensagens de erro nem em log.
 * @returns {Promise<{ url: string }>}
 */
export async function aguardarReviewApp({
  sha,
  pipelineId,
  token,
  fetchFn = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => esperar(ms),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
}) {
  const headers = {
    Accept: 'application/vnd.heroku+json; version=3',
    Authorization: `Bearer ${token}`,
  }
  const get = async (caminho) => {
    const resposta = await fetchFn(`${API}${caminho}`, { headers })
    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error(
        `Heroku recusou as credenciais (HTTP ${resposta.status}): verifique HEROKU_API_KEY`
      )
    }
    if (!resposta.ok) throw erroHttp(resposta.status, caminho)
    return resposta.json()
  }

  const prazo = now() + timeoutMs
  let viuReviewApp = false
  let ultimoErro = ''

  const consultar = async () => {
    const apps = await get(`/pipelines/${encodeURIComponent(pipelineId)}/review-apps`)
    const revApp = (apps ?? []).filter((a) => a.commit === sha).at(-1)
    if (!revApp) return null
    viuReviewApp = true
    if (revApp.status === 'errored') {
      throw new Error(`Review app falhou para ${sha} (status: errored)`)
    }
    if (revApp.status !== 'created') return null
    const app = await get(`/apps/${encodeURIComponent(revApp.app?.id)}`)
    if (!app?.web_url)
      throw new Error(`Review app sem URL para ${sha} (status created sem web_url)`)
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
      pipelineId: ctx.config.heroku.pipelineId,
      token,
    })
    return url
  },
}
