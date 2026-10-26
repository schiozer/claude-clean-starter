#!/usr/bin/env node
// PR gate (spec release-management §4.2): valida de forma determinística o título, a linha
// `Spec:` e a seção de UAT do corpo do PR. Sem Claude, sem custo; o job só lê o evento
// (`GITHUB_EVENT_PATH`) e o checkout do head.

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MAX_TITLE_LENGTH = 72
export const TITLE_PATTERN =
  /^(feat|fix|refactor|docs|style|test|chore|ci|perf|build|revert)(\([a-z0-9-]+\))?(!)?: .+/

const SPECS_DIR = 'docs/superpowers/specs/'
const SPEC_TEMPLATE_NAME = '_TEMPLATE.md'
const SPEC_LINE = /^Spec:[ \t]*(.+)$/gm
const SPEC_NA = /^n\/a(?: *[—-] *(.*))?$/i
const UAT_APPROVED = /^- \[([ xX])\] UAT aprovado[ \t]*$/im
const UAT_NOT_APPLICABLE = /^- \[([ xX])\] UAT não se aplica(?:[ \t]*[—-][ \t]*(.*))?$/im
// tipos em que `Spec: n/a` não é aceito (mudança de comportamento).
const TYPES_REQUIRING_SPEC = ['feat', 'refactor']

/** @typedef {{ type: string, scope: string | null, breaking: boolean }} ParsedTitle */

const normalize = (text) => (text ?? '').replace(/\r\n?/g, '\n')

/** Texto sem placeholders `<…>`; vazio significa que o autor não preencheu. */
const stripPlaceholders = (text) => text.replace(/<[^>]*>/g, '').trim()

/**
 * @param {string} title
 * @returns {ParsedTitle | null}
 */
export function parseTitle(title) {
  const match = TITLE_PATTERN.exec(title)
  if (!match) return null
  return { type: match[1], scope: match[2] ? match[2].slice(1, -1) : null, breaking: !!match[3] }
}

/**
 * @param {string} body
 * @returns {{ kind: 'path', path: string } | { kind: 'na', reason: string } | { kind: 'error', message: string }}
 */
export function parseSpecLine(body) {
  const lines = [...normalize(body).matchAll(SPEC_LINE)].map((match) => match[1].trim())
  if (lines.length === 0) {
    return {
      kind: 'error',
      message:
        'Falta a linha "Spec:" no corpo. Use "Spec: docs/superpowers/specs/<arquivo>.md" ou "Spec: n/a — <motivo>".',
    }
  }
  if (lines.length > 1) {
    return {
      kind: 'error',
      message: `Há ${lines.length} linhas "Spec:" no corpo; deixe exatamente uma.`,
    }
  }
  const na = SPEC_NA.exec(lines[0])
  if (na) {
    const reason = stripPlaceholders(na[1] ?? '')
    if (!reason) {
      return { kind: 'error', message: '"Spec: n/a" exige um motivo: "Spec: n/a — <motivo>".' }
    }
    return { kind: 'na', reason }
  }
  return { kind: 'path', path: lines[0] }
}

/**
 * @param {string} body
 * @returns {{ present: boolean, approved: boolean, notApplicable: boolean, reason: string }}
 */
export function parseUat(body) {
  const text = normalize(body)
  const approved = UAT_APPROVED.exec(text)
  const notApplicable = UAT_NOT_APPLICABLE.exec(text)
  return {
    present: !!approved && !!notApplicable,
    approved: !!approved && approved[1] !== ' ',
    notApplicable: !!notApplicable && notApplicable[1] !== ' ',
    reason: stripPlaceholders(notApplicable?.[2] ?? ''),
  }
}

const isValidSpecPath = (path) => {
  const name = path.split('/').pop()
  return (
    path.startsWith(SPECS_DIR) &&
    path.endsWith('.md') &&
    name !== SPEC_TEMPLATE_NAME &&
    !path.split('/').includes('..')
  )
}

const checkTitle = (title) => {
  const errors = []
  const parsed = parseTitle(title)
  if (!parsed) {
    errors.push(
      `Título fora do padrão "tipo(escopo): mensagem" (tipos: feat, fix, refactor, docs, style, test, chore, ci, perf, build, revert; escopo em minúsculas, "!" opcional, ": " com espaço). Edite o título do PR.`
    )
  }
  if (title.length > MAX_TITLE_LENGTH) {
    errors.push(
      `Título com ${title.length} caracteres; o máximo é ${MAX_TITLE_LENGTH}. Encurte o título do PR.`
    )
  }
  return { parsed, errors }
}

const checkSpec = (body, parsedTitle, fileExists) => {
  const spec = parseSpecLine(body)
  if (spec.kind === 'error') return [spec.message]
  if (spec.kind === 'na') {
    if (parsedTitle && (TYPES_REQUIRING_SPEC.includes(parsedTitle.type) || parsedTitle.breaking)) {
      return [
        `"Spec: n/a" não é aceito para ${parsedTitle.breaking ? 'títulos com "!"' : `"${parsedTitle.type}"`} (mudança de comportamento). Aponte a spec em ${SPECS_DIR}.`,
      ]
    }
    return []
  }
  if (!isValidSpecPath(spec.path)) {
    return [
      `Caminho de spec inválido ("${spec.path}"): use um arquivo .md em ${SPECS_DIR}, diferente de ${SPEC_TEMPLATE_NAME} e sem "..". Ou use "Spec: n/a — <motivo>" quando permitido.`,
    ]
  }
  if (!fileExists(spec.path)) {
    return [
      `A spec "${spec.path}" não existe no head do PR. Inclua o arquivo ou corrija o caminho.`,
    ]
  }
  return []
}

const checkUat = (body, action) => {
  const uat = parseUat(body)
  if (!uat.present) {
    return [
      'Falta a seção "## UAT" com as duas opções: "- [ ] UAT aprovado" e "- [ ] UAT não se aplica — <motivo>". Restaure-as a partir do template.',
    ]
  }
  const errors = []
  if (action === 'opened' && (uat.approved || uat.notApplicable)) {
    errors.push(
      'Na abertura do PR nenhuma opção de UAT pode estar marcada: o UAT é marcado pelo humano depois de testar. Desmarque a opção; o humano marca depois.'
    )
  }
  if (uat.approved && uat.notApplicable) {
    errors.push(
      'duas opções de UAT marcadas: deixe só uma ("UAT aprovado" ou "UAT não se aplica — <motivo>").'
    )
  } else if (uat.notApplicable && !uat.reason) {
    errors.push('"UAT não se aplica" exige um motivo: "- [x] UAT não se aplica — <motivo>".')
  }
  return errors
}

/**
 * @param {{ title: string, body: string, action: string, fileExists: (path: string) => boolean }} input
 * @returns {string[]} erros em pt-BR, cada um com a correção; `[]` = ok.
 */
export function checkPr({ title, body, action, fileExists }) {
  const { parsed, errors: titleErrors } = checkTitle(title ?? '')
  return [
    ...titleErrors,
    ...checkSpec(body ?? '', parsed, fileExists),
    ...checkUat(body ?? '', action),
  ]
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const { GITHUB_EVENT_PATH } = process.env
    if (!GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH é obrigatório')
    const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8'))
    const errors = checkPr({
      title: event.pull_request?.title ?? '',
      body: event.pull_request?.body ?? '',
      action: event.action ?? '',
      fileExists: (path) => existsSync(path),
    })
    if (errors.length === 0) {
      process.stdout.write('pr-gate: título, spec e seção de UAT ok.\n')
    } else {
      process.stderr.write(
        `pr-gate: ${errors.length} problema(s):\n${errors.map((e) => `- ${e}`).join('\n')}\n` +
          'Edite o título ou o corpo do PR: isso re-dispara o gate.\n'
      )
      process.exit(1)
    }
  } catch (error) {
    process.stderr.write(
      `pr-gate: erro — ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exit(1)
  }
}
