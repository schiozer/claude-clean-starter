#!/usr/bin/env node
// Guarda da main (camada 3, spec main-autogarantida §6): num push para uma branch protegida,
// verifica se cada commit novo veio de um PR mergeado; senão abre/atualiza uma issue de alarme
// e falha o job. Não reverte nada — a decisão é do humano, via PR.

import { readFileSync, realpathSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LABEL = 'main-sem-pr'
const DEFAULT_RETRIES = 3
const DEFAULT_DELAY_MS = 10000
const ZERO_SHA = /^0+$/
const BRANCH_PREFIX = 'refs/heads/'

/**
 * @typedef {{ ref: string, before: string, after: string, forced?: boolean }} PushEvent
 * @typedef {{ merged_at: string | null, base: { ref: string } }} PullInfo
 * @typedef {{
 *   compare(base: string, head: string): Promise<string[]>,
 *   pullsForCommit(sha: string): Promise<PullInfo[]>,
 *   findOpenIssue(label: string): Promise<number | null>,
 *   createIssue(title: string, body: string, label: string): Promise<void>,
 *   comment(issue: number, body: string): Promise<void>,
 * }} GuardApi
 */

/** Lançado por `compare` quando a lista de commits veio truncada (fail-closed). */
export class CompareTruncatedError extends Error {}

/** protectedBranches do checkout (`hooks/protect-main/config.json`). */
export const readProtectedBranches = (root = process.cwd()) =>
  JSON.parse(readFileSync(resolve(root, 'hooks/protect-main/config.json'), 'utf8'))
    .protectedBranches

/** @param {GuardApi} api @param {string} sha @param {string} branch */
const hasMergedPr = async (api, sha, branch, retries, delayMs) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const pulls = await api.pullsForCommit(sha)
    if (pulls.some((pr) => pr.merged_at && pr.base.ref === branch)) return true
    if (attempt < retries) await sleep(delayMs)
  }
  return false
}

const buildBody = (event, offending, note) =>
  [
    `Chegou(aram) à \`${event.ref.slice(BRANCH_PREFIX.length)}\` commit(s) sem PR mergeado associado.`,
    '',
    `Push: \`${event.before}..${event.after}\`${event.forced ? ' (force push)' : ''}`,
    '',
    'Commits suspeitos:',
    ...offending.map((sha) => `- ${sha}`),
    ...(note ? ['', note] : []),
    '',
    'Isso significa que uma mudança entrou na branch protegida sem passar por PR, violando a ' +
      'regra 0 do CLAUDE.md e a ADR-005. Nada foi revertido automaticamente: um humano deve ' +
      'revisar e, se necessário, reverter via PR.',
  ].join('\n')

/**
 * @param {PushEvent} event
 * @param {GuardApi} api
 * @param {{ retries?: number, delayMs?: number, protectedBranches?: string[] }} [opts]
 * @returns {Promise<{ ok: boolean, offending: string[] }>}
 */
export async function runMainGuard(event, api, opts = {}) {
  const retries = opts.retries ?? DEFAULT_RETRIES
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS
  const protectedBranches = opts.protectedBranches ?? readProtectedBranches()

  if (!event.ref.startsWith(BRANCH_PREFIX)) return { ok: true, offending: [] }
  const branch = event.ref.slice(BRANCH_PREFIX.length)
  if (!protectedBranches.includes(branch)) return { ok: true, offending: [] }
  if (ZERO_SHA.test(event.before)) return { ok: true, offending: [] }

  let commits = []
  let note = ''
  let failClosed = false
  try {
    commits = await api.compare(event.before, event.after)
  } catch (error) {
    if (!event.forced && !(error instanceof CompareTruncatedError)) throw error
    failClosed = true
    note = `Não foi possível listar todos os commits do push (${
      error instanceof Error ? error.message : String(error)
    }); tratado como alarme por segurança.`
  }

  let offending = []
  if (event.forced || failClosed) {
    offending = commits.length > 0 && !failClosed ? commits : [event.after]
    if (event.forced && !note) note = 'O push foi forçado (force push).'
  } else {
    for (const sha of commits) {
      if (!(await hasMergedPr(api, sha, branch, retries, delayMs))) offending.push(sha)
    }
  }
  if (offending.length === 0) return { ok: true, offending }

  const body = buildBody(event, offending, note)
  const existing = await api.findOpenIssue(LABEL)
  if (existing) await api.comment(existing, body)
  else await api.createIssue(`Commit na main sem PR: ${event.after.slice(0, 7)}`, body, LABEL)
  return { ok: false, offending }
}

/** GuardApi sobre a REST do GitHub (fetch nativo). */
export function makeGithubApi({
  token,
  repository,
  apiUrl = 'https://api.github.com',
  fetchFn = globalThis.fetch,
}) {
  const call = async (method, path, body) => {
    const response = await fetchFn(`${apiUrl}/repos/${repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok && !(method === 'POST' && response.status === 422)) {
      throw new Error(`GitHub API ${method} ${path} falhou: HTTP ${response.status}`)
    }
    return response
  }

  return {
    async compare(base, head) {
      const data = await (await call('GET', `/compare/${base}...${head}?per_page=100`)).json()
      const shas = data.commits.map((commit) => commit.sha)
      if (data.total_commits > shas.length) {
        throw new CompareTruncatedError(
          `compare retornou ${shas.length} de ${data.total_commits} commits`
        )
      }
      return shas
    },
    async pullsForCommit(sha) {
      return (await call('GET', `/commits/${sha}/pulls`)).json()
    },
    async findOpenIssue(label) {
      const issues = await (
        await call('GET', `/issues?labels=${label}&state=open&per_page=1`)
      ).json()
      return issues[0]?.number ?? null
    },
    async createIssue(title, body, label) {
      // 422 = label já existe (ignorado em `call`).
      await call('POST', '/labels', { name: label, color: 'b60205' })
      await call('POST', '/issues', { title, body, labels: [label] })
    },
    async comment(issue, body) {
      await call('POST', `/issues/${issue}/comments`, { body })
    },
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const { GITHUB_EVENT_PATH, GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL } = process.env
    if (!GITHUB_EVENT_PATH || !GITHUB_TOKEN || !GITHUB_REPOSITORY) {
      throw new Error('GITHUB_EVENT_PATH, GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios')
    }
    const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8'))
    const api = makeGithubApi({
      token: GITHUB_TOKEN,
      repository: GITHUB_REPOSITORY,
      apiUrl: GITHUB_API_URL || undefined,
    })
    const { ok, offending } = await runMainGuard(event, api)
    if (ok) {
      process.stdout.write('main-guard: todos os commits vieram de PR mergeado.\n')
    } else {
      process.stderr.write(`main-guard: commit(s) na main sem PR:\n${offending.join('\n')}\n`)
      process.exit(1)
    }
  } catch (error) {
    process.stderr.write(
      `main-guard: erro — ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exit(1)
  }
}
