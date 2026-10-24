#!/usr/bin/env node
// Guarda dos git hooks versionados (.githooks/): recusa mudar uma branch protegida localmente,
// salvo alinhá-la a `origin/<branch>`, e recusa push cujo destino seja uma branch protegida
// (spec main-autogarantida §4.2–§4.5). Funções puras + entrypoint chamado pelos shims:
//   node git-guard.mjs reference-transaction <state>   (stdin: `<old> <new> <ref>`)
//   node git-guard.mjs pre-push <remote> <url>         (stdin: `<lref> <lsha> <rref> <rsha>`)
// exit 1 + stderr = recusa; exit 0 = liberado.

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOCK_PREFIX } from './evaluate.mjs'

/** @typedef {{ oldSha: string, newSha: string, ref: string }} RefUpdate */
/** @typedef {{ localRef: string, localSha: string, remoteRef: string, remoteSha: string }} PushUpdate */

/**
 * @typedef {object} RefTransactionContext
 * @property {string[]} protectedBranches Branches que só recebem mudanças via PR.
 * @property {(branch: string) => string | null} originSha Valor de `refs/remotes/origin/<branch>`
 *   no repositório (null = não existe).
 * @property {(branch: string) => string | null} localSha Valor atual de `refs/heads/<branch>`
 *   (null = não existe).
 */

const ZERO_SHA = /^0+$/
const REMOTE = 'origin'
const FINAL_LINE = 'Atualizar a `main` local com `git pull` continua permitido.'
const GIT_TIMEOUT_MS = 5000

const heads = (branch) => `refs/heads/${branch}`
const isZero = (sha) => ZERO_SHA.test(sha)

/**
 * Decide uma transação de refs no estado `prepared`. Para cada linha de `refs/heads/<protegida>`:
 * apagar → permite; novo valor = `origin/<protegida>` (da mesma transação ou do repositório) →
 * permite; novo valor = valor local atual (regravação sem mudança, ex.: `git pack-refs`/`gc`) →
 * permite; criação sem `origin/<protegida>` (repo novo) → permite; qualquer outro → recusa.
 * @param {RefUpdate[]} lines
 * @param {RefTransactionContext} ctx
 * @returns {string | null} Motivo da recusa (começa com `BLOCK_PREFIX`) ou null.
 */
export function checkRefTransaction(lines, ctx) {
  // `git fetch origin main:main` atualiza `origin/main` na mesma transação: vale o valor novo.
  const sameTransaction = new Map(lines.map((line) => [line.ref, line.newSha]))
  for (const branch of ctx.protectedBranches) {
    const originRef = `refs/remotes/${REMOTE}/${branch}`
    for (const line of lines) {
      if (line.ref !== heads(branch) || isZero(line.newSha)) continue
      const origin = sameTransaction.get(originRef) ?? ctx.originSha(branch)
      if (origin !== null && line.newSha === origin) continue
      if (isZero(line.oldSha) && origin === null) continue
      if (line.newSha === ctx.localSha(branch)) continue
      return (
        `${BLOCK_PREFIX} O hook \`reference-transaction\` recusou mudar \`${heads(branch)}\` ` +
        `localmente: ela só pode ser alinhada a \`${REMOTE}/${branch}\`. Para atualizá-la, use ` +
        `\`git pull --ff-only\` ou \`git reset --hard ${REMOTE}/${branch}\`.\n${FINAL_LINE}`
      )
    }
  }
  return null
}

/**
 * Recusa o push se qualquer destino é `refs/heads/<protegida>` (atualizar, forçar ou apagar),
 * exceto criá-la num remoto que ainda não a tem (`remoteSha` zerado; bootstrap de repo vazio).
 * O git já resolveu `--all`, `--mirror`, globs e `push.default` antes do hook.
 * @param {PushUpdate[]} lines
 * @param {string[]} protectedBranches
 * @returns {string | null}
 */
export function checkPrePush(lines, protectedBranches) {
  const blocked = new Set(protectedBranches.map(heads))
  const isCreation = (line) => isZero(line.remoteSha) && !isZero(line.localSha)
  const hit = lines.find((line) => blocked.has(line.remoteRef) && !isCreation(line))
  if (!hit) return null
  return `${BLOCK_PREFIX} O push para \`${hit.remoteRef}\` foi recusado pelo hook \`pre-push\`.\n${FINAL_LINE}`
}

/** Linhas não vazias do stdin, já separadas em campos. */
const fieldsOf = (raw) =>
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.split(/\s+/))

// `rev-parse --verify --quiet` sai com 1 (sem saída) quando a ref não existe; o resto relança.
function revParse(ref) {
  try {
    const out = execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
    }).trim()
    return out === '' ? null : out
  } catch (error) {
    if (error.status === 1 && !error.signal) return null
    throw error
  }
}

const originSha = (branch) => revParse(`refs/remotes/${REMOTE}/${branch}`)
const localSha = (branch) => revParse(heads(branch))

function readProtectedBranches() {
  const configPath = join(dirname(fileURLToPath(import.meta.url)), 'config.json')
  return JSON.parse(readFileSync(configPath, 'utf8')).protectedBranches
}

/**
 * @param {string[]} args `[hook, ...argumentos do git]`
 * @param {string} raw stdin do hook
 * @returns {string | null}
 */
function evaluateHook([hook, state], raw) {
  const protectedBranches = readProtectedBranches()
  const lines = fieldsOf(raw)
  if (hook === 'reference-transaction') {
    if (state !== 'prepared') return null
    const updates = lines.map(([oldSha, newSha, ref]) => ({ oldSha, newSha, ref }))
    return checkRefTransaction(updates, { protectedBranches, originSha, localSha })
  }
  if (hook === 'pre-push') {
    const updates = lines.map(([localRef, localSha, remoteRef, remoteSha]) => ({
      localRef,
      localSha,
      remoteRef,
      remoteSha,
    }))
    return checkPrePush(updates, protectedBranches)
  }
  throw new Error(`hook desconhecido: ${hook}`)
}

/** Fail-closed: sem conseguir ler o config, qualquer linha `refs/heads/*` conta como protegida. */
function touchesProtected(raw) {
  let names = null
  try {
    names = readProtectedBranches()
  } catch {
    // config ilegível: cai no critério amplo abaixo.
  }
  return fieldsOf(raw).some((fields) => {
    const ref = fields[2] ?? ''
    return names ? names.some((name) => ref === heads(name)) : ref.startsWith('refs/heads/')
  })
}

function main() {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
    const reason = evaluateHook(process.argv.slice(2), raw)
    if (reason === null) return 0
    console.error(reason)
    return 1
  } catch (error) {
    if (!touchesProtected(raw)) return 0
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `${BLOCK_PREFIX} O guard dos git hooks falhou; não o desligue — corrija-o. (${message})\n${FINAL_LINE}`
    )
    return 1
  }
}

// Importado pelos testes não executa; executado pelos shims, roda o hook.
const isEntrypoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (isEntrypoint) process.exitCode = main()
