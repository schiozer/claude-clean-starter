#!/usr/bin/env node
// Guarda da main (camada 3, spec main-autogarantida §6): num push para uma branch protegida,
// verifica se cada commit novo veio de um PR mergeado; senão abre/atualiza uma issue de alarme
// e falha o job. Também alarma merges que pularam os gates de saúde (checks obrigatórios, UAT,
// squash) — spec 2026-10-25 release-management §4.5. Não reverte nada — a decisão é do humano.

import { readFileSync, realpathSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { latestCheckRun, makeGithubClient } from './github-api.mjs'
import { parseUat } from './pr-gate.mjs'

const LABEL = 'main-sem-pr'
const GATES_LABEL = 'merge-sem-gates'
const DEFAULT_RETRIES = 3
const DEFAULT_DELAY_MS = 10000
// checks ainda rodando (queued/in_progress): espera até 20 × 15 s = 5 min no total.
const DEFAULT_PENDING_POLL_MS = 15000
const DEFAULT_PENDING_MAX_POLLS = 20
const PAGE_SIZE = 100
// o compare do GitHub limita a 250 commits no total.
const COMPARE_MAX_PAGES = 3
const ZERO_SHA = /^0+$/
const BRANCH_PREFIX = 'refs/heads/'

/**
 * @typedef {{ ref: string, before: string, after: string, forced?: boolean, deleted?: boolean }} PushEvent
 * @typedef {{
 *   number: number, title: string, body: string | null, merged_at: string | null,
 *   base: { ref: string }, head: { sha: string },
 * }} PullInfo
 * @typedef {{
 *   name: string, status: string, conclusion: string | null, id?: number, started_at?: string | null,
 * }} CheckRun
 * @typedef {{
 *   compare(base: string, head: string): Promise<string[]>,
 *   pullsForCommit(sha: string): Promise<PullInfo[]>,
 *   checkRuns(sha: string): Promise<CheckRun[]>,
 *   commitParents(sha: string): Promise<string[]>,
 *   findOpenIssue(label: string): Promise<number | null>,
 *   createIssue(title: string, body: string, label: string): Promise<void>,
 *   comment(issue: number, body: string): Promise<void>,
 * }} GuardApi
 */

/** Lançado por `compare` quando a lista de commits veio truncada (fail-closed). */
export class CompareTruncatedError extends Error {}

const readConfig = (root = process.cwd()) =>
  JSON.parse(readFileSync(resolve(root, 'hooks/protect-main/config.json'), 'utf8'))

/** protectedBranches do checkout (`hooks/protect-main/config.json`). */
export const readProtectedBranches = (root = process.cwd()) => readConfig(root).protectedBranches

/**
 * Commits ainda sem PR mergeado após `retries` tentativas (uma espera por rodada) e os PRs
 * mergeados encontrados, deduplicados por número (com os commits da main de cada um).
 */
const findUnmerged = async (api, commits, branch, retries, delayMs) => {
  let pending = commits
  const pulls = new Map()
  for (let attempt = 1; attempt <= retries && pending.length > 0; attempt++) {
    const found = await Promise.all(
      pending.map(async (sha) => {
        const prs = await api.pullsForCommit(sha)
        return prs.find((pr) => pr.merged_at && pr.base.ref === branch) ?? null
      })
    )
    found.forEach((pr, index) => {
      if (!pr) return
      const entry = pulls.get(pr.number) ?? { pr, shas: [] }
      entry.shas.push(pending[index])
      pulls.set(pr.number, entry)
    })
    pending = pending.filter((_, index) => !found[index])
    if (pending.length > 0 && attempt < retries) await sleep(delayMs)
  }
  return { pending, pulls: [...pulls.values()] }
}

/**
 * Itens faltando (pt-BR) de um PR mergeado; lista vazia = todos os gates cumpridos.
 * @param {PullInfo} pr
 * @param {{ checkRuns: CheckRun[], parents: string[], requiredChecks: string[] }} ctx
 * @returns {string[]}
 */
export function evaluateGates(pr, { checkRuns, parents, requiredChecks }) {
  const missing = []
  for (const name of requiredChecks) {
    const run = latestCheckRun(checkRuns, name)
    if (!run) missing.push(`check "${name}" ausente`)
    else if (run.status !== 'completed' || run.conclusion !== 'success') {
      missing.push(`check "${name}" com conclusão ${run.conclusion ?? run.status}`)
    }
  }
  const uat = parseUat(pr.body ?? '')
  if (uat.approved && uat.notApplicable) missing.push('duas opções de UAT marcadas')
  else if (uat.notApplicable && !uat.reason) missing.push('UAT "não se aplica" sem motivo')
  else if (!uat.approved && !uat.notApplicable) missing.push('UAT não marcado')
  if (parents.length > 1) missing.push('merge commit (2 pais): use squash')
  return missing
}

const hasPendingCheck = (checkRuns, requiredChecks) =>
  requiredChecks.some((name) => {
    const run = latestCheckRun(checkRuns, name)
    return !!run && run.status !== 'completed'
  })

/**
 * Avalia os gates de um PR relendo checks/pais a cada rodada (checks podem chegar atrasados).
 * Check pendente espera até `pending.maxPolls` leituras extras; ausente/falho usa `retries`.
 */
const gateFailureFor = async (api, { pr, shas }, requiredChecks, retries, delayMs, pending) => {
  let missing = []
  let attempt = 1
  let polls = 0
  for (;;) {
    const checkRuns = await api.checkRuns(pr.head.sha)
    const parents = []
    for (const sha of shas) {
      const found = await api.commitParents(sha)
      if (found.length > parents.length) parents.splice(0, parents.length, ...found)
    }
    missing = evaluateGates(pr, { checkRuns, parents, requiredChecks })
    if (missing.length === 0) return null
    if (hasPendingCheck(checkRuns, requiredChecks)) {
      if (polls >= pending.maxPolls) break
      polls++
      await sleep(pending.pollMs)
    } else {
      if (attempt >= retries) break
      attempt++
      await sleep(delayMs)
    }
  }
  return { pr: pr.number, sha: shas[0], missing }
}

const buildBody = (event, offending, note) =>
  [
    `Chegaram à \`${event.ref.slice(BRANCH_PREFIX.length)}\` commits sem PR mergeado:`,
    '',
    `Push: \`${event.before}..${event.after}\`${event.forced ? ' (force push)' : ''}`,
    '',
    'Commits:',
    ...offending.map((sha) => `- ${sha}`),
    ...(note ? ['', note] : []),
    '',
    'Isso significa que uma mudança entrou na branch protegida sem passar por PR, violando a ' +
      'regra 0 do CLAUDE.md e a ADR-005. Nada foi revertido automaticamente: um humano deve ' +
      'revisar e, se necessário, reverter via PR.',
  ].join('\n')

const buildGatesBody = (failure, branch, specGateCheck) =>
  [
    `O PR #${failure.pr} foi mergeado na \`${branch}\` (commit ${failure.sha}) sem cumprir os gates:`,
    '',
    ...failure.missing.map((item) => `- ${item}`),
    ...(specGateCheck && failure.missing.some((item) => item.includes(`"${specGateCheck}"`))
      ? [
          '',
          `Se \`SPEC_GATE\` foi ligado com o PR aberto, o check "${specGateCheck}" pode não ter ` +
            'rodado nele: re-rode o check no PR antes do próximo merge.',
        ]
      : []),
    '',
    'Nada foi revertido automaticamente: um humano deve revisar e, se necessário, corrigir via PR.',
  ].join('\n')

const raise = async (api, label, title, body) => {
  const existing = await api.findOpenIssue(label)
  if (existing) await api.comment(existing, body)
  else await api.createIssue(title, body, label)
}

/**
 * @param {PushEvent} event
 * @param {GuardApi} api
 * @param {{
 *   retries?: number, delayMs?: number, pendingPollMs?: number, pendingMaxPolls?: number,
 *   protectedBranches?: string[], requiredChecks?: string[], specGate?: boolean,
 * }} [opts]
 * @returns {Promise<{
 *   ok: boolean, offending: string[],
 *   gateFailures: { pr: number, sha: string, missing: string[] }[],
 * }>}
 */
export async function runMainGuard(event, api, opts = {}) {
  const retries = opts.retries ?? DEFAULT_RETRIES
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS
  const pending = {
    pollMs: opts.pendingPollMs ?? DEFAULT_PENDING_POLL_MS,
    maxPolls: opts.pendingMaxPolls ?? DEFAULT_PENDING_MAX_POLLS,
  }
  const config = readConfig()
  const protectedBranches = opts.protectedBranches ?? config.protectedBranches
  const specGate = opts.specGate ?? process.env.SPEC_GATE === 'on'
  const requiredChecks = [
    ...(opts.requiredChecks ?? config.requiredChecks ?? []),
    ...(specGate && config.specGateCheck ? [config.specGateCheck] : []),
  ]
  const clean = { ok: true, offending: [], gateFailures: [] }

  if (!event.ref.startsWith(BRANCH_PREFIX)) return clean
  const branch = event.ref.slice(BRANCH_PREFIX.length)
  if (!protectedBranches.includes(branch)) return clean
  const deleted = event.deleted === true || ZERO_SHA.test(event.after)
  if (!deleted && ZERO_SHA.test(event.before)) return clean

  let commits = []
  let note = ''
  let failClosed = false
  try {
    if (!deleted) commits = await api.compare(event.before, event.after)
  } catch (error) {
    if (!event.forced && !(error instanceof CompareTruncatedError)) throw error
    failClosed = true
    note = `Não foi possível listar todos os commits do push (${
      error instanceof Error ? error.message : String(error)
    }); tratado como alarme por segurança.`
  }

  let offending = []
  let pulls = []
  if (deleted) {
    offending = [event.before]
    note = 'A branch protegida foi removida (delete) sem PR.'
  } else if (event.forced || failClosed) {
    offending = commits.length > 0 && !failClosed ? commits : [event.after]
    if (event.forced && !note) note = 'O push foi forçado (force push).'
  } else {
    ;({ pending: offending, pulls } = await findUnmerged(api, commits, branch, retries, delayMs))
  }

  if (offending.length > 0) {
    await raise(
      api,
      LABEL,
      `Commit na main sem PR: ${(deleted ? event.before : event.after).slice(0, 7)}`,
      buildBody(event, offending, note)
    )
  }

  const gateFailures = []
  for (const entry of pulls) {
    const failure = await gateFailureFor(api, entry, requiredChecks, retries, delayMs, pending)
    if (!failure) continue
    gateFailures.push(failure)
    await raise(
      api,
      GATES_LABEL,
      `Merge sem gates: #${failure.pr} (${failure.sha.slice(0, 7)})`,
      buildGatesBody(failure, branch, specGate ? config.specGateCheck : undefined)
    )
  }
  return { ok: offending.length === 0 && gateFailures.length === 0, offending, gateFailures }
}

/** GuardApi sobre a REST do GitHub (fetch nativo). */
export function makeGithubApi({ token, repository, apiUrl, fetchFn }) {
  const { call, paginate } = makeGithubClient({
    token,
    repository,
    apiUrl,
    fetchFn,
    userAgent: 'main-guard',
  })

  return {
    async compare(base, head) {
      const shas = []
      let total = Infinity
      for (let page = 1; shas.length < total && page <= COMPARE_MAX_PAGES; page++) {
        const url = `/compare/${base}...${head}?per_page=${PAGE_SIZE}&page=${page}`
        const data = await call('GET', url)
        if (!Number.isInteger(data.total_commits)) {
          throw new CompareTruncatedError('compare sem total_commits válido')
        }
        total = data.total_commits
        const batch = data.commits.map((commit) => commit.sha)
        if (batch.length === 0) break
        shas.push(...batch)
      }
      if (shas.length < total) {
        throw new CompareTruncatedError(`compare retornou ${shas.length} de ${total} commits`)
      }
      return shas
    },
    async pullsForCommit(sha) {
      return call('GET', `/commits/${sha}/pulls`)
    },
    async checkRuns(sha) {
      return paginate(`/commits/${sha}/check-runs?filter=latest`, (page) => page.check_runs)
    },
    async commitParents(sha) {
      return (await call('GET', `/commits/${sha}`)).parents.map((parent) => parent.sha)
    },
    async findOpenIssue(label) {
      const url = `/issues?labels=${encodeURIComponent(label)}&state=open&per_page=${PAGE_SIZE}`
      const issues = await call('GET', url)
      // a API de issues também lista PRs; só interessa issue de verdade.
      return issues.find((issue) => !('pull_request' in issue))?.number ?? null
    },
    async createIssue(title, body, label) {
      try {
        await call('POST', '/labels', { name: label, color: 'b60205' })
      } catch (error) {
        if (error.status !== 422) throw error // 422 = label já existe
      }
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
    const { ok, offending, gateFailures } = await runMainGuard(event, api)
    if (ok) {
      process.stdout.write('main-guard: todos os commits vieram de PR mergeado, com gates ok.\n')
    } else {
      if (offending.length > 0) {
        process.stderr.write(`main-guard: commit(s) na main sem PR:\n${offending.join('\n')}\n`)
      }
      for (const { pr, missing } of gateFailures) {
        process.stderr.write(`main-guard: PR #${pr} sem gates:\n- ${missing.join('\n- ')}\n`)
      }
      process.exit(1)
    }
  } catch (error) {
    process.stderr.write(
      `main-guard: erro — ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exit(1)
  }
}
