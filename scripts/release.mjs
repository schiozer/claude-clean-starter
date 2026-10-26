#!/usr/bin/env node
// Release por merge (spec 2026-10-25 release-management): a cada push na main (squash de um PR),
// calcula a próxima versão SemVer a partir das tags, cria a tag anotada e o GitHub Release.

import { readFileSync, realpathSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { latestCheckRun, makeGithubClient } from './github-api.mjs'
import { parseSpecLine, parseTitle, parseUat } from './pr-gate.mjs'

const ZERO_SHA = /^0+$/
const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/
const BREAKING_BODY = /\bBREAKING[ -]CHANGE\b/
const SPEC_GATE_LABEL = { ok: 'ok', pulado: 'pulado', vermelho: 'vermelho' }
// a associação commit → PR pode demorar a aparecer na API logo após o merge.
const DEFAULT_RETRIES = 3
const DEFAULT_DELAY_MS = 10000

/**
 * @typedef {{ number: number, html_url?: string, title: string, body: string | null,
 *   merged_at: string | null, base: { ref: string }, head: { sha: string } }} PullInfo
 * @typedef {{
 *   name: string, status: string, conclusion: string | null, id?: number, started_at?: string | null,
 * }} CheckRun
 * @typedef {{
 *   tags(): Promise<{ name: string, sha: string }[]>,
 *   pullsForCommit(sha: string): Promise<PullInfo[]>,
 *   commitMessage(sha: string): Promise<string>,
 *   compare(base: string, head: string): Promise<string[]>,
 *   checkRuns(sha: string): Promise<CheckRun[]>,
 *   releaseExists(tag: string): Promise<boolean>,
 *   createTag(tag: string, sha: string, message: string): Promise<void>,
 *   createRelease(tag: string, name: string, body: string): Promise<void>,
 * }} ReleaseApi
 */

const readConfig = (root = process.cwd()) =>
  JSON.parse(readFileSync(resolve(root, 'hooks/protect-main/config.json'), 'utf8'))

/** @returns {'major' | 'minor' | 'patch'} */
export function bumpType(title, body) {
  const parsed = parseTitle(title)
  if (parsed?.breaking || BREAKING_BODY.test(body ?? '')) return 'major'
  if (parsed?.type === 'feat') return 'minor'
  return 'patch'
}

const parseVersion = (tag) => {
  const match = VERSION_TAG.exec(tag)
  return match ? match.slice(1).map(Number) : null
}

const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** Próxima versão (com `v`) a partir da maior tag `vX.Y.Z`; sem tags, a do package.json. */
export function nextVersion(tags, change, packageVersion) {
  const highest = tags.map(parseVersion).filter(Boolean).sort(compareVersions).at(-1)
  if (!highest) return packageVersion
  const [major, minor, patch] = highest
  const bump = bumpType(change.title, change.body)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const specLink = (body, prUrl, tag) => {
  const spec = parseSpecLine(body)
  if (spec.kind === 'na') return `n/a — ${spec.reason}`
  if (spec.kind !== 'path') return 'não informada'
  const base = prUrl ? /^(.*)\/pull\/\d+/.exec(prUrl)?.[1] : null
  return base ? `[${spec.path}](${base}/blob/${tag}/${spec.path})` : spec.path
}

const uatLine = (body) => {
  const uat = parseUat(body)
  if (uat.approved) return 'aprovado'
  if (uat.notApplicable) return `n.a. — ${uat.reason}`
  return 'não marcado'
}

export function buildReleaseNotes({ title, tag, prNumber, prUrl, body, specGate, commits }) {
  const lines = [`## ${title}`, '']
  if (prNumber !== null) lines.push(`PR: ${prUrl ? `[#${prNumber}](${prUrl})` : `#${prNumber}`}`)
  lines.push(
    `Spec: ${specLink(body, prUrl, tag)}`,
    `Spec × código: ${SPEC_GATE_LABEL[specGate]}`,
    `UAT: ${uatLine(body)}`
  )
  if (commits.length > 1) lines.push('', '### Commits', ...commits.map((sha) => `- ${sha}`))
  return `${lines.join('\n')}\n`
}

const specGateState = async (api, pr, specGateCheck) => {
  if (!pr) return 'pulado'
  const run = latestCheckRun(await api.checkRuns(pr.head.sha), specGateCheck)
  if (!run || run.conclusion === 'skipped') return 'pulado'
  return run.status === 'completed' && run.conclusion === 'success' ? 'ok' : 'vermelho'
}

const findMergedPull = async (api, sha, retries, delayMs) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const pulls = await api.pullsForCommit(sha)
    const pr = pulls.find((pull) => pull.merged_at && pull.base.ref === 'main')
    if (pr) return pr
    if (attempt < retries) await sleep(delayMs)
  }
  return null
}

/**
 * @param {{ before: string, after: string }} event
 * @param {ReleaseApi} api
 * @param {{ packageVersion: string, specGateCheck?: string, retries?: number, delayMs?: number }} opts
 * @returns {Promise<{ created: boolean, tag: string, releaseCreated?: boolean }>}
 */
export async function runRelease({ before, after }, api, opts) {
  const { packageVersion } = opts
  const specGateCheck = opts.specGateCheck ?? readConfig().specGateCheck
  const tags = await api.tags()
  const existing = tags.find((tag) => tag.sha === after)
  // tag já existe: só recria a Release se ela sumiu (ex.: run anterior falhou depois da tag).
  if (existing && (await api.releaseExists(existing.name))) {
    return { created: false, tag: existing.name }
  }

  const pr = await findMergedPull(
    api,
    after,
    opts.retries ?? DEFAULT_RETRIES,
    opts.delayMs ?? DEFAULT_DELAY_MS
  )
  const title = pr ? pr.title : (await api.commitMessage(after)).split('\n')[0]
  const body = pr ? (pr.body ?? '') : ''

  const tag =
    existing?.name ??
    `v${nextVersion(
      tags.map((t) => t.name),
      { title, body },
      packageVersion
    ).replace(/^v/, '')}`
  const commits = ZERO_SHA.test(before) ? [after] : await api.compare(before, after)
  const specGate = await specGateState(api, pr, specGateCheck)
  const notes = buildReleaseNotes({
    title,
    tag,
    prNumber: pr?.number ?? null,
    prUrl: pr?.html_url ?? null,
    body,
    specGate,
    commits,
  })

  if (!existing) await api.createTag(tag, after, title)
  await api.createRelease(tag, `${tag} — ${title}`, notes)
  return existing ? { created: false, releaseCreated: true, tag } : { created: true, tag }
}

/** @param {{ token: string, repository: string, apiUrl?: string, fetchFn?: typeof fetch }} opts */
export function makeReleaseApi({ token, repository, apiUrl, fetchFn }) {
  const { call, paginate } = makeGithubClient({
    token,
    repository,
    apiUrl,
    fetchFn,
    userAgent: 'release',
  })
  return {
    async tags() {
      const tags = await paginate('/tags')
      return tags.map((tag) => ({ name: tag.name, sha: tag.commit.sha }))
    },
    async pullsForCommit(sha) {
      return call('GET', `/commits/${sha}/pulls`)
    },
    async commitMessage(sha) {
      return (await call('GET', `/commits/${sha}`)).commit.message
    },
    async compare(base, head) {
      const data = await call('GET', `/compare/${base}...${head}`)
      return data.commits.map((commit) => commit.sha)
    },
    async checkRuns(sha) {
      return paginate(`/commits/${sha}/check-runs?filter=latest`, (page) => page.check_runs)
    },
    async releaseExists(tag) {
      try {
        await call('GET', `/releases/tags/${encodeURIComponent(tag)}`)
        return true
      } catch (error) {
        if (error.status === 404) return false
        throw error
      }
    },
    async createTag(tag, sha, message) {
      await call('POST', '/git/tags', { tag, message, object: sha, type: 'commit' })
      await call('POST', '/git/refs', { ref: `refs/tags/${tag}`, sha })
    },
    async createRelease(tag, name, body) {
      await call('POST', '/releases', { tag_name: tag, name, body })
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
    const root = process.cwd()
    const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const { specGateCheck } = readConfig(root)
    const api = makeReleaseApi({
      token: GITHUB_TOKEN,
      repository: GITHUB_REPOSITORY,
      apiUrl: GITHUB_API_URL || undefined,
    })
    const { created, releaseCreated, tag } = await runRelease(event, api, {
      packageVersion: version,
      specGateCheck,
    })
    if (created) process.stdout.write(`release: ${tag} criada.\n`)
    else if (releaseCreated)
      process.stdout.write(`release: tag ${tag} já existia; Release criada.\n`)
    else process.stdout.write(`release: commit já tem a tag ${tag} e a Release; nada a fazer.\n`)
  } catch (error) {
    process.stderr.write(
      `release: erro — ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exit(1)
  }
}
