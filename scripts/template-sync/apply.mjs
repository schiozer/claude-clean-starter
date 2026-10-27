// Aplica o plano do template sync no projeto (spec 2026-10-27-template-sync-design.md §5.2):
// casos limpos direto, três vias com `git merge-file`, JSON validado depois da junção.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readControl, writeControl } from './control.mjs'
import { git, readBlob } from './git.mjs'
import { adrMoves, rewriteProjectLinks } from './links.mjs'

/**
 * @typedef {import('./classify.mjs').PlanEntry} PlanEntry
 * @typedef {import('./classify.mjs').Case} Case
 * @typedef {{ base: string | null, target: { tag: string, commit: string }, entries: PlanEntry[] }} Plan
 * @typedef {{
 *   applied: string[], merged: string[],
 *   conflicts: { path: string, kind: 'markers' | 'invalid-json' }[],
 *   asked: { path: string, case: Case }[], notes: string[], linkRewrites: string[],
 * }} ApplyReport
 */

const EXAMPLE_REF = /examples\/|\(example\)/

/**
 * Junção de três vias; `conflicts` = nº de blocos em conflito.
 * @param {string} templateDir
 * @param {{ base: string, target: string, project: Buffer }} blobs
 * @returns {{ content: Buffer, conflicts: number }}
 */
export function mergeBlobs(templateDir, { base, target, project }) {
  const dir = mkdtempSync(join(tmpdir(), 'template-sync-merge-'))
  try {
    const files = {
      projeto: project,
      base: readBlob(templateDir, base),
      template: readBlob(templateDir, target),
    }
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
    try {
      const content = git(dir, [
        'merge-file',
        '-p',
        '-L',
        'projeto',
        '-L',
        'base',
        '-L',
        'template',
        'projeto',
        'base',
        'template',
      ])
      return { content, conflicts: 0 }
    } catch (error) {
      const status = /** @type {{ status?: number, stdout?: Buffer }} */ (error).status
      const stdout = /** @type {{ stdout?: Buffer }} */ (error).stdout
      if (typeof status === 'number' && status > 0 && status < 128 && stdout) {
        return { content: stdout, conflicts: status }
      }
      throw error
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Arquivos escritos/juntados que citam o exemplo num projeto sem `examples/`.
 * @param {string} projectDir
 * @param {string[]} paths
 * @returns {string[]}
 */
export function examplesNotes(projectDir, paths) {
  if (existsSync(join(projectDir, 'examples'))) return []
  return paths
    .filter((path) => {
      const full = join(projectDir, path)
      return existsSync(full) && EXAMPLE_REF.test(readFileSync(full, 'utf8'))
    })
    .map(
      (path) =>
        `${path}: cita o exemplo (examples/), que o projeto não tem — decida no PR se remove.`
    )
}

/**
 * Modos dos arquivos do template no alvo (para manter scripts executáveis).
 * @param {string} templateDir
 * @param {string} commit
 */
function executables(templateDir, commit) {
  const out = git(templateDir, ['ls-tree', '-r', '-z', commit]).toString('utf8').split('\0')
  return new Set(
    out.filter((l) => l.startsWith('100755 ')).map((l) => l.slice(l.indexOf('\t') + 1))
  )
}

/**
 * @param {string} full
 * @param {Buffer} content
 * @param {boolean} executable
 */
function writeFile(full, content, executable) {
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  if (executable) chmodSync(full, 0o755)
}

/** @param {string} path */
const isJson = (path) => path.endsWith('.json')

/**
 * @param {{ templateDir: string, projectDir: string, plan: Plan }} input
 * @returns {ApplyReport}
 */
export function applyPlan({ templateDir, projectDir, plan }) {
  /** @type {ApplyReport} */
  const report = { applied: [], merged: [], conflicts: [], asked: [], notes: [], linkRewrites: [] }
  const exec = executables(templateDir, plan.target.commit)
  const at = (/** @type {string} */ path) => join(projectDir, path)

  for (const entry of plan.entries) {
    const { path, action } = entry
    if (action === 'none') continue
    if (action === 'ask') {
      report.asked.push({ path, case: entry.case })
      continue
    }
    if (action === 'delete') {
      rmSync(at(path), { force: true })
      report.applied.push(path)
      continue
    }
    if (action === 'write' || action === 'move') {
      writeFile(
        at(path),
        readBlob(templateDir, /** @type {string} */ (entry.target)),
        exec.has(path)
      )
      if (entry.from && entry.from !== path) rmSync(at(entry.from), { force: true })
      report.applied.push(path)
      continue
    }
    // merge
    const source = at(entry.from ?? path)
    const { content, conflicts } = mergeBlobs(templateDir, {
      base: /** @type {string} */ (entry.base),
      target: /** @type {string} */ (entry.target),
      project: readFileSync(source),
    })
    if (entry.from && entry.from !== path) rmSync(source, { force: true })
    writeFile(at(path), content, exec.has(path))
    if (conflicts > 0) {
      report.conflicts.push({ path, kind: 'markers' })
      continue
    }
    if (isJson(path)) {
      try {
        JSON.parse(content.toString('utf8'))
      } catch {
        report.conflicts.push({ path, kind: 'invalid-json' })
        continue
      }
    }
    report.merged.push(path)
  }
  const renamed = new Map(
    plan.entries
      .filter((e) => e.from && (e.action === 'move' || e.action === 'merge'))
      .map((e) => [e.path, /** @type {string} */ (e.from)])
  )
  report.linkRewrites = rewriteProjectLinks(projectDir, adrMoves(renamed))
  report.notes = examplesNotes(projectDir, [...report.applied, ...report.merged])
  return report
}

/**
 * Grava o `lastSync` novo; preserva `template` e `projectOwned`.
 * @param {{ projectDir: string, templateUrl?: string, tag: string, commit: string, date: string }} input
 * @returns {import('./control.mjs').Control}
 */
export function finishSync({ projectDir, templateUrl, tag, commit, date }) {
  const current = readControl(projectDir)
  const template = current?.template ?? templateUrl
  if (!template) throw new Error('Adoção: informe --template-url.')
  const control = {
    template,
    lastSync: { version: tag, commit, date },
    projectOwned: current?.projectOwned ?? [],
  }
  writeControl(projectDir, control)
  return control
}
