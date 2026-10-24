#!/usr/bin/env node
// Aplica `core.hooksPath=.githooks` (git hooks versionados que travam a main localmente) e
// garante o bit executável dos shims (spec main-autogarantida §4.4). Rodado pelo `prepare` do
// npm e pelo SessionStart (autorreparo). Imprime a ação em stdout; sai 0 sempre, salvo git
// quebrado (1).

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS_PATH = '.githooks'
const SHIMS = ['reference-transaction', 'pre-push']
const EXEC_BITS = 0o111

/** @typedef {'skipped' | 'unchanged' | 'installed' | 'replaced'} InstallAction */

/** @param {string} dir @param {string[]} args */
const git = (dir, args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** Raiz do git de `dir`, ou null se `dir` não está num repositório. */
const gitRoot = (dir) => {
  try {
    return realpathSync(git(dir, ['rev-parse', '--show-toplevel']).trim())
  } catch (error) {
    // git instalado mas fora de repo → status 128; git ausente/quebrado → propaga.
    if (error && typeof error === 'object' && 'status' in error && error.status === 128) return null
    throw error
  }
}

/** Valor local de core.hooksPath ('' se ausente). */
const localHooksPath = (dir) => {
  try {
    return git(dir, ['config', '--local', '--get', 'core.hooksPath']).trim()
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) return ''
    throw error
  }
}

/** @param {string} dir */
const ensureExecutable = (dir) => {
  for (const shim of SHIMS) {
    const file = join(dir, HOOKS_PATH, shim)
    if (!existsSync(file)) continue
    const mode = statSync(file).mode
    if ((mode & EXEC_BITS) !== EXEC_BITS) chmodSync(file, 0o755)
  }
}

/**
 * @param {string} dir Diretório do package.json (deve ser a raiz do repositório git).
 * @returns {{ action: InstallAction, previous: string | null }}
 */
export function installGitHooks(dir) {
  const root = gitRoot(dir)
  if (root === null || root !== realpathSync(resolve(dir))) {
    return { action: 'skipped', previous: null }
  }

  ensureExecutable(root)

  const current = localHooksPath(root)
  if (current === HOOKS_PATH) return { action: 'unchanged', previous: null }

  git(root, ['config', '--local', 'core.hooksPath', HOOKS_PATH])
  if (current === '') return { action: 'installed', previous: null }
  return { action: 'replaced', previous: current }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const projectDir = resolve(fileURLToPath(import.meta.url), '..', '..')
    const { action, previous } = installGitHooks(projectDir)
    if (action === 'replaced') {
      process.stderr.write(
        `protect-main: core.hooksPath era '${previous}' e foi substituído por '${HOOKS_PATH}'. ` +
          `Hooks extras do projeto devem morar em '${HOOKS_PATH}/'.\n`
      )
    }
    process.stdout.write(`${action}\n`)
  } catch (error) {
    process.stderr.write(
      `protect-main: não foi possível instalar os git hooks (git quebrado?): ${
        error instanceof Error ? error.message : String(error)
      }\n`
    )
    process.exit(1)
  }
}
