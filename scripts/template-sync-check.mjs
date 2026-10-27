#!/usr/bin/env node
// Aviso semanal do template sync (spec 2026-10-27-template-sync-design.md §3.A): compara o
// `lastSync` do projeto com as Releases do template e mantém uma única issue `template-sync`.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { makeGithubClient } from './github-api.mjs'
import { readControl } from './template-sync/control.mjs'

const LABEL = 'template-sync'
const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/
const REPO_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/
const FOOTER = 'Rode /template-sync no projeto para trazer as mudanças (abre um PR).'
const NO_CONTROL =
  'Sem .template-sync.json (repositório do template ou projeto ainda não adotado): nada a fazer.'
const CURRENT_COMMENT = 'Em dia com o template.'
// limite do corpo de issue do GitHub é 65 536 caracteres.
const MAX_BODY = 60000

/**
 * @typedef {import('./template-sync/control.mjs').LastSync} LastSync
 * @typedef {{ releases(): Promise<{ tag: string, body: string }[]>, compareStatus(base: string, head: string): Promise<string> }} TemplateApi
 * @typedef {{
 *   findOpenIssue(label: string): Promise<number | null>,
 *   createIssue(title: string, body: string, label: string): Promise<void>,
 *   updateIssue(issue: number, title: string, body: string): Promise<void>,
 *   closeIssue(issue: number, comment: string): Promise<void>,
 * }} ProjectApi
 */

/**
 * @param {string} url
 * @returns {string} `<owner>/<repo>`
 */
export function parseRepoUrl(url) {
  const match = url.match(REPO_URL)
  if (!match) throw new Error(`URL do template não é um repositório do GitHub: ${url}`)
  return `${match[1]}/${match[2]}`
}

/** @param {string} tag */
const semver = (tag) =>
  /** @type {RegExpMatchArray} */ (tag.match(VERSION_TAG)).slice(1).map(Number)

/** @param {string} a @param {string} b */
function compareTags(a, b) {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/**
 * @param {{ lastSync: LastSync, releases: { tag: string, body: string, after: boolean }[] }} input
 * @returns {{ state: 'behind', title: string, body: string } | { state: 'current' }}
 */
export function evaluateBehind({ lastSync, releases }) {
  const pending = releases.filter((r) => r.after).sort((a, b) => compareTags(a.tag, b.tag))
  if (pending.length === 0) return { state: 'current' }
  const from = lastSync.version ?? 'base anterior às Releases'
  const to = /** @type {{ tag: string }} */ (pending.at(-1)).tag
  const count = pending.length === 1 ? '1 versão atrás' : `${pending.length} versões atrás`
  let notes = pending.map((r) => `## ${r.tag}\n\n${r.body.trim() || '(sem notas)'}`).join('\n\n')
  if (notes.length > MAX_BODY)
    notes = `${notes.slice(0, MAX_BODY)}\n\n(notas truncadas — veja as Releases do template)`
  return {
    state: 'behind',
    title: `Template: ${count} (${from} → ${to})`,
    body: `${notes}\n\n---\n\n${FOOTER}\n`,
  }
}

/**
 * @param {{ root: string, templateApi: TemplateApi, projectApi: ProjectApi, log?: (msg: string) => void }} input
 * @returns {Promise<'no-control' | 'current' | 'behind'>}
 */
export async function runCheck({ root, templateApi, projectApi, log = () => {} }) {
  const control = readControl(root)
  if (!control) {
    log(NO_CONTROL)
    return 'no-control'
  }
  const { lastSync } = control
  const all = (await templateApi.releases()).filter((r) => VERSION_TAG.test(r.tag))
  const releases = []
  for (const release of all) {
    const after =
      lastSync.version !== null
        ? compareTags(release.tag, lastSync.version) > 0
        : (await templateApi.compareStatus(lastSync.commit, release.tag)) === 'ahead'
    releases.push({ ...release, after })
  }
  const result = evaluateBehind({ lastSync, releases })
  const open = await projectApi.findOpenIssue(LABEL)
  if (result.state === 'current') {
    if (open !== null) await projectApi.closeIssue(open, CURRENT_COMMENT)
    log('template-sync-check: em dia com o template.')
    return 'current'
  }
  if (open !== null) await projectApi.updateIssue(open, result.title, result.body)
  else await projectApi.createIssue(result.title, result.body, LABEL)
  log(`template-sync-check: ${result.title}`)
  return 'behind'
}

/**
 * @param {{ token: string, repository: string, apiUrl?: string }} opts
 * @returns {TemplateApi}
 */
export function makeTemplateApi(opts) {
  const { call, paginate } = makeGithubClient({ ...opts, userAgent: 'template-sync-check' })
  return {
    async releases() {
      const list = await paginate('/releases')
      return list
        .filter((r) => !r.draft && !r.prerelease)
        .map((r) => ({ tag: r.tag_name, body: r.body ?? '' }))
    },
    async compareStatus(base, head) {
      try {
        return (await call('GET', `/compare/${base}...${encodeURIComponent(head)}`)).status
      } catch (error) {
        if (/** @type {{ status?: number }} */ (error).status === 404) return 'diverged'
        throw error
      }
    },
  }
}

/**
 * @param {{ token: string, repository: string, apiUrl?: string }} opts
 * @returns {ProjectApi}
 */
export function makeProjectApi(opts) {
  const { call } = makeGithubClient({ ...opts, userAgent: 'template-sync-check' })
  return {
    async findOpenIssue(label) {
      const issues = await call(
        'GET',
        `/issues?labels=${encodeURIComponent(label)}&state=open&per_page=100`
      )
      // a API de issues também lista PRs; só interessa issue de verdade.
      return (
        issues.find((/** @type {object} */ issue) => !('pull_request' in issue))?.number ?? null
      )
    },
    async createIssue(title, body, label) {
      try {
        await call('POST', '/labels', { name: label, color: '0e8a16' })
      } catch (error) {
        if (/** @type {{ status?: number }} */ (error).status !== 422) throw error // 422 = label já existe
      }
      await call('POST', '/issues', { title, body, labels: [label] })
    },
    async updateIssue(issue, title, body) {
      await call('PATCH', `/issues/${issue}`, { title, body })
    },
    async closeIssue(issue, comment) {
      await call('POST', `/issues/${issue}/comments`, { body: comment })
      await call('PATCH', `/issues/${issue}`, { state: 'closed' })
    },
  }
}

const isMain =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL } = process.env
    const root = process.cwd()
    const control = readControl(root)
    if (!control) {
      process.stdout.write(`${NO_CONTROL}\n`)
    } else {
      if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
        throw new Error('GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios')
      }
      const apiUrl = GITHUB_API_URL || undefined
      await runCheck({
        root,
        templateApi: makeTemplateApi({
          token: GITHUB_TOKEN,
          repository: parseRepoUrl(control.template),
          apiUrl,
        }),
        projectApi: makeProjectApi({ token: GITHUB_TOKEN, repository: GITHUB_REPOSITORY, apiUrl }),
        log: (msg) => process.stdout.write(`${msg}\n`),
      })
    }
  } catch (error) {
    process.stderr.write(
      `template-sync-check: erro — ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exit(1)
  }
}
