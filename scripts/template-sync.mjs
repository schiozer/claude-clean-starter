#!/usr/bin/env node
// Motor do template sync (spec 2026-10-27-template-sync-design.md): classifica os arquivos
// gerenciados em três vias (base × alvo × projeto) e devolve JSON para a skill `template-sync`.

import { readFileSync, realpathSync } from 'node:fs'
import { applyPlan, finishSync } from './template-sync/apply.mjs'
import { fileURLToPath } from 'node:url'
import { buildPlan } from './template-sync/classify.mjs'
import { readControl } from './template-sync/control.mjs'
import { makeMatcher } from './template-sync/manifest.mjs'
import {
  isClean,
  projectBlobs,
  readManifestAt,
  renames,
  resolveCommit,
  treeBlobs,
} from './template-sync/git.mjs'

/**
 * `--chave valor` → { chave: valor }; `--map` pode repetir.
 * @param {string[]} argv
 * @returns {Record<string, string | string[]>}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | string[]>} */
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) throw new Error(`argumento inesperado: ${key}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} sem valor.`)
    const name = key.slice(2)
    const prev = args[name]
    args[name] = prev === undefined ? value : [...(Array.isArray(prev) ? prev : [prev]), value]
    i += 1
  }
  return args
}

/**
 * @param {Record<string, string | string[]>} args
 * @param {string} name
 */
function required(args, name) {
  const value = args[name]
  if (typeof value !== 'string') throw new Error(`informe --${name}.`)
  return value
}

/**
 * @param {string} repo
 * @param {string} rev
 */
function commitOf(repo, rev) {
  try {
    return resolveCommit(repo, rev)
  } catch {
    throw new Error(`revisão ${rev} não existe no template.`)
  }
}

/**
 * @param {{ template: string, project: string, target: string, base?: string }} opts
 */
export function plan({ template, project, target, base }) {
  const targetCommit = commitOf(template, target)
  let baseCommit
  if (base === 'none') baseCommit = null
  else if (base !== undefined) baseCommit = commitOf(template, base)
  else {
    const control = readControl(project)
    if (!control) {
      throw new Error('projeto sem .template-sync.json: na adoção, informe --base <sha|none>.')
    }
    baseCommit = commitOf(template, control.lastSync.commit)
  }
  const manifests = [readManifestAt(template, targetCommit)]
  if (baseCommit) manifests.push(readManifestAt(template, baseCommit))
  const present = manifests.filter((m) => m !== null)
  if (present.length === 0) throw new Error(`o template em ${target} não tem manifesto.`)
  const control = readControl(project)
  const entries = buildPlan({
    base: treeBlobs(template, baseCommit),
    target: treeBlobs(template, targetCommit),
    project: projectBlobs(project),
    renames: baseCommit ? renames(template, baseCommit, targetCommit) : new Map(),
    isManaged: makeMatcher(...present),
    projectOwned: control?.projectOwned ?? [],
  })
  return { base: baseCommit, target: { tag: target, commit: targetCommit }, entries }
}

const DIRTY = 'Árvore suja no projeto: faça commit ou stash antes do sync.'

/** Data local de hoje em AAAA-MM-DD. */
export function today(now = new Date()) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** @type {Record<string, (args: Record<string, string | string[]>) => unknown>} */
export const COMMANDS = {
  plan: (args) =>
    plan({
      template: required(args, 'template'),
      project: required(args, 'project'),
      target: required(args, 'target'),
      base: typeof args.base === 'string' ? args.base : undefined,
    }),
  apply: (args) => {
    const projectDir = required(args, 'project')
    if (!isClean(projectDir)) throw new Error(DIRTY)
    const plan = JSON.parse(readFileSync(required(args, 'plan'), 'utf8'))
    return applyPlan({ templateDir: required(args, 'template'), projectDir, plan })
  },
  finish: (args) => {
    const template = required(args, 'template')
    const tag = required(args, 'target')
    return finishSync({
      projectDir: required(args, 'project'),
      templateUrl: typeof args['template-url'] === 'string' ? args['template-url'] : undefined,
      tag,
      commit: commitOf(template, tag),
      date: today(),
    })
  },
}

const isMain =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const [command, ...rest] = process.argv.slice(2)
  try {
    const run = command ? COMMANDS[command] : undefined
    if (!run)
      throw new Error(
        `comando desconhecido: ${command ?? '(nenhum)'}. Use: ${Object.keys(COMMANDS).join(', ')}.`
      )
    process.stdout.write(`${JSON.stringify(await run(parseArgs(rest)), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(
      `template-sync: erro — ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exit(1)
  }
}
