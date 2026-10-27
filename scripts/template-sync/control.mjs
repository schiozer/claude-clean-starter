// Arquivo de controle do projeto (spec 2026-10-27 template-sync §6): de qual Release do template
// o projeto partiu no último sync.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONTROL_PATH = '.template-sync.json'

/**
 * @typedef {{ version: string | null, commit: string, date: string }} LastSync
 * @typedef {{ template: string, lastSync: LastSync, projectOwned: string[] }} Control
 */

const VERSION = /^v\d+\.\d+\.\d+$/
const SHA = /^[0-9a-f]{40}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const invalid = (field, detail) => new Error(`${CONTROL_PATH} inválido: ${field} ${detail}`)

/** @returns {Control} */
export function parseControl(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw invalid('raiz', 'deve ser um objeto.')
  }
  const { template, lastSync, projectOwned = [] } = /** @type {Record<string, any>} */ (json)
  if (typeof template !== 'string' || !template.startsWith('https://')) {
    throw invalid('template', 'deve ser a URL https do repositório do template.')
  }
  if (!lastSync || typeof lastSync !== 'object') throw invalid('lastSync', 'é obrigatório.')
  const { version, commit, date } = lastSync
  if (version !== null && !(typeof version === 'string' && VERSION.test(version))) {
    throw invalid('lastSync.version', 'deve ser vX.Y.Z ou null (base anterior às Releases).')
  }
  if (typeof commit !== 'string' || !SHA.test(commit)) {
    throw invalid('lastSync.commit', 'deve ser o sha completo (40 hex).')
  }
  if (typeof date !== 'string' || !DATE.test(date)) {
    throw invalid('lastSync.date', 'deve ser AAAA-MM-DD.')
  }
  if (!Array.isArray(projectOwned) || !projectOwned.every((p) => typeof p === 'string')) {
    throw invalid('projectOwned', 'deve ser lista de caminhos.')
  }
  return { template, lastSync: { version, commit, date }, projectOwned }
}

/** @returns {Control | null} `null` quando o projeto ainda não adotou o sync. */
export function readControl(projectDir) {
  const path = join(projectDir, CONTROL_PATH)
  if (!existsSync(path)) return null
  let json
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw invalid('arquivo', 'não é JSON válido.')
  }
  return parseControl(json)
}

/** @param {Control} control */
export function writeControl(projectDir, control) {
  writeFileSync(join(projectDir, CONTROL_PATH), `${JSON.stringify(parseControl(control), null, 2)}\n`)
}
