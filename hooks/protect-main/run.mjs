#!/usr/bin/env node
// Hook PreToolUse (matcher Bash): bloqueia comandos que levam mudanças à `main` sem PR.
// stdin = payload do Claude Code; exit 2 + stderr = bloqueio; exit 0 = liberado.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOCK_PREFIX, evaluateCommand } from './evaluate.mjs'

const GIT_TIMEOUT_MS = 5000

function git(dir, args) {
  if (!existsSync(dir)) return null
  try {
    const out = execFileSync('git', ['-C', dir, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
    }).trim()
    return out === '' ? null : out
  } catch {
    return null
  }
}

const branchOf = (dir) => git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
const aliasOf = (dir, name) => git(dir, ['config', '--get', `alias.${name}`])

function main(raw) {
  const payload = JSON.parse(raw)
  const command = payload?.tool_input?.command
  if (payload?.tool_name !== 'Bash' || typeof command !== 'string' || command === '') return 0

  const config = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'config.json'), 'utf8')
  )
  const verdict = evaluateCommand(command, {
    cwd: typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd(),
    protectedBranches: config.protectedBranches,
    branchOf,
    aliasOf,
  })
  if (verdict.allowed) return 0
  console.error(verdict.reason)
  return 2
}

let raw = ''
try {
  raw = readFileSync(0, 'utf8')
  process.exitCode = main(raw)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/\bgit\b|\bgh\b/.test(raw)) {
    console.error(
      `${BLOCK_PREFIX} O hook protect-main falhou; não o desligue — corrija o hook. (${message})`
    )
    process.exitCode = 2
  } else {
    console.error(`protect-main: falha ao avaliar o comando (liberado): ${message}`)
    process.exitCode = 0
  }
}
