// Espera genérica do deploy de preview (spec camada-de-deploy): polling na API de deployments do
// GitHub até `success` (URL do preview), `failure`/`error` ou timeout. O filtro do ambiente é
// injetável (`ambienteDePreview`, que também recebe o deployment, ex.: para filtrar por `ref`); o
// padrão é o da Vercel (`Preview*`). `rotulo` nomeia o deploy nas mensagens (padrão `preview`).

import { setTimeout as esperar } from 'node:timers/promises'

export const DEFAULT_TIMEOUT_MS = 900_000
export const DEFAULT_INTERVAL_MS = 15_000

const FALHOU = ['failure', 'error']

/** @typedef {{ id: number, environment: string, ref?: string, created_at: string }} Deployment */
/** @typedef {{ state: string, environment_url?: string, target_url?: string }} DeploymentStatus */

const maisRecente = (a, b) =>
  String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id

const minutos = (ms) => `${Math.round(ms / 60_000)} min`

/** 5xx e 403/429 (rate limit) da API do GitHub: tenta de novo no próximo ciclo, até o prazo. */
const transitorio = (error) =>
  typeof error?.status === 'number' &&
  (error.status >= 500 || error.status === 403 || error.status === 429)

/**
 * Espera um Deployment do GitHub do `sha` cujo ambiente casa com `ambienteDePreview` (apesar do
 * nome, serve a qualquer ambiente: preview, UAT, Production). Devolve a URL e o `id` do deployment.
 * @param {{
 *   api: { call: (method: string, path: string) => Promise<unknown> },
 *   sha: string, ambienteDePreview?: (environment: string, deployment: Deployment) => boolean,
 *   rotulo?: string, timeoutMs?: number, intervalMs?: number,
 *   now?: () => number, sleep?: (ms: number) => Promise<void>,
 * }} opts
 * @returns {Promise<{ url: string, id: number }>}
 */
export async function aguardarDeployment({
  api,
  sha,
  ambienteDePreview = (e) => e.startsWith('Preview'),
  rotulo = 'preview',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = Date.now,
  sleep = (ms) => esperar(ms),
}) {
  const prazo = now() + timeoutMs
  let viuDeploy = false
  let ultimoErro = ''

  /** Uma consulta: `{ url }` se pronto, `null` se ainda não; lança se falhou. */
  const consultar = async () => {
    const deployments = /** @type {Deployment[]} */ (
      await api.call('GET', `/deployments?sha=${encodeURIComponent(sha)}&per_page=100`)
    )
    const deploy = (deployments ?? [])
      .filter((d) => typeof d.environment === 'string' && ambienteDePreview(d.environment, d))
      .sort(maisRecente)
      .at(-1)
    if (!deploy) return null
    viuDeploy = true
    // a API devolve os status do mais novo para o mais antigo.
    const statuses = /** @type {DeploymentStatus[]} */ (
      await api.call('GET', `/deployments/${deploy.id}/statuses?per_page=1`)
    )
    const atual = statuses?.[0]
    if (atual?.state === 'success') {
      const url = atual.environment_url || atual.target_url
      if (!url) throw new Error(`Deploy de ${rotulo} sem URL para ${sha} (status success sem URL)`)
      return { url, id: deploy.id }
    }
    if (atual && FALHOU.includes(atual.state)) {
      throw new Error(`Deploy de ${rotulo} falhou para ${sha} (status: ${atual.state})`)
    }
    return null
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
        (viuDeploy
          ? `Deploy de ${rotulo} para ${sha} não ficou pronto em ${minutos(timeoutMs)}`
          : `Nenhum deploy de ${rotulo} para ${sha} em ${minutos(timeoutMs)}`) + ultimoErro
      )
    }
    await sleep(Math.min(intervalMs, Math.max(prazo - now(), 0)))
  }
}

/**
 * Espera do deploy de preview (contrato atual): como `aguardarDeployment`, devolvendo só a URL.
 * @param {Parameters<typeof aguardarDeployment>[0]} opts
 * @returns {Promise<{ url: string }>}
 */
export async function waitPreview(opts) {
  const { url } = await aguardarDeployment(opts)
  return { url }
}
