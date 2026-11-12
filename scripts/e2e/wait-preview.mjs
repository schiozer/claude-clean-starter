#!/usr/bin/env node
// Espera o deploy Preview da Vercel do SHA do PR (spec e2e-regressao-docs §8.2): polling na API de
// deployments do GitHub até `success` (URL do preview), `failure`/`error` ou timeout. Usado pelo
// job `Regressão (UAT)` com `E2E_TARGET=preview`; a CLI escreve só `url=<…>` em `$GITHUB_OUTPUT`.

import { appendFileSync, realpathSync } from 'node:fs'
import { setTimeout as esperar } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { makeGithubClient } from '../github-api.mjs'

export const DEFAULT_TIMEOUT_MS = 900_000
export const DEFAULT_INTERVAL_MS = 15_000

const FALHOU = ['failure', 'error']

/** @typedef {{ id: number, environment: string, created_at: string }} Deployment */
/** @typedef {{ state: string, environment_url?: string, target_url?: string }} DeploymentStatus */

const maisRecente = (a, b) =>
  String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id

const minutos = (ms) => `${Math.round(ms / 60_000)} min`

/** 5xx e 403/429 (rate limit) da API do GitHub: tenta de novo no próximo ciclo, até o prazo. */
const transitorio = (error) =>
  typeof error?.status === 'number' &&
  (error.status >= 500 || error.status === 403 || error.status === 429)

/**
 * @param {{
 *   api: { call: (method: string, path: string) => Promise<unknown> },
 *   sha: string, timeoutMs?: number, intervalMs?: number,
 *   now?: () => number, sleep?: (ms: number) => Promise<void>,
 * }} opts
 * @returns {Promise<{ url: string }>}
 */
export async function waitPreview({
  api,
  sha,
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
      .filter((d) => typeof d.environment === 'string' && d.environment.startsWith('Preview'))
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
      if (!url) throw new Error(`Deploy de preview sem URL para ${sha} (status success sem URL)`)
      return { url }
    }
    if (atual && FALHOU.includes(atual.state)) {
      throw new Error(`Deploy de preview falhou para ${sha} (status: ${atual.state})`)
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
          ? `Deploy de preview para ${sha} não ficou pronto em ${minutos(timeoutMs)}`
          : `Nenhum deploy de preview para ${sha} em ${minutos(timeoutMs)}`) + ultimoErro
      )
    }
    await sleep(Math.min(intervalMs, Math.max(prazo - now(), 0)))
  }
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_OUTPUT, PREVIEW_SHA } =
      process.env
    if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !PREVIEW_SHA) {
      throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY e PREVIEW_SHA são obrigatórios')
    }
    const api = makeGithubClient({
      token: GITHUB_TOKEN,
      repository: GITHUB_REPOSITORY,
      apiUrl: GITHUB_API_URL,
      userAgent: 'e2e-wait-preview',
    })
    const { url } = await waitPreview({ api, sha: PREVIEW_SHA })
    if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `url=${url}\n`)
    process.stdout.write(`wait-preview: preview pronto em ${url}\n`)
  } catch (error) {
    process.stderr.write(
      `wait-preview: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exit(1)
  }
}
