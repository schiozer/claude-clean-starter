// Reescrita de links para ADRs do template que mudaram para docs/adr/template/
// (spec 2026-10-27-template-sync-design.md §5.4). Links para ADRs do projeto nunca mudam.

import { readFileSync, writeFileSync } from 'node:fs'
import { posix } from 'node:path'
import { join } from 'node:path'
import { git } from './git.mjs'

const ADR_DIRECT = /^docs\/adr\/[^/]+\.md$/
const ADR_TEMPLATE = /^docs\/adr\/template\/[^/]+\.md$/
const TEXT_FILE = /\.(md|ts|tsx|mjs|js|json|ya?ml)$/

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Renomes de ADR do template: caminho velho → novo.
 * @param {Map<string, string>} renames novo → velho
 * @returns {Map<string, string>}
 */
export function adrMoves(renames) {
  const moves = new Map()
  for (const [to, from] of renames) {
    if (ADR_DIRECT.test(from) && ADR_TEMPLATE.test(to)) moves.set(from, to)
  }
  return moves
}

/**
 * @param {string} text
 * @param {string} filePath caminho do arquivo no repo (posix)
 * @param {Map<string, string>} moves velho → novo
 * @returns {string}
 */
export function rewriteAdrLinks(text, filePath, moves) {
  const inAdrDir = ADR_DIRECT.test(filePath)
  let out = text
  for (const [from, to] of moves) {
    const name = escape(posix.basename(from))
    const target = posix.basename(to)
    out = out.replace(new RegExp(`(^|[^\\w.-])adr/${name}`, 'g'), `$1adr/template/${target}`)
    if (inAdrDir) out = out.replace(new RegExp(`\\((?:\\./)?${name}`, 'g'), `(./template/${target}`)
  }
  return out
}

/**
 * Aplica a reescrita nos arquivos de texto rastreados do projeto.
 * @param {string} projectDir
 * @param {Map<string, string>} moves
 * @returns {string[]} arquivos alterados
 */
export function rewriteProjectLinks(projectDir, moves) {
  if (moves.size === 0) return []
  const files = git(projectDir, ['ls-files', '-z']).toString('utf8').split('\0')
  const changed = []
  for (const file of files) {
    if (!file || !TEXT_FILE.test(file)) continue
    const full = join(projectDir, file)
    let text
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      continue // apagado no working tree pelo apply
    }
    const next = rewriteAdrLinks(text, file, moves)
    if (next !== text) {
      writeFileSync(full, next)
      changed.push(file)
    }
  }
  return changed
}
