#!/usr/bin/env node
// PR gate (spec release-management §4.2): valida de forma determinística o título, a linha
// `Spec:` e a seção de UAT do corpo do PR. Sem Claude, sem custo; o job só lê o evento
// (`GITHUB_EVENT_PATH`) e o checkout do head.

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lerEsteira } from './esteira/config.mjs'
import { classificarPr } from './esteira/regras.mjs'

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

const BACK_PROMOTION_TITLE = /^chore\(release\): back-promotion de v\d+\.\d+\.\d+$/
const AVISO_MERGE_COMMIT = 'mergeie com "Create a merge commit", nunca squash'

/** Classificação por base/head; `null` = sem esteira ou base fora dela (comportamento de hoje). */
const classify = (base, head, esteira) => {
  if (!esteira || !base || !head) return null
  if (base !== esteira.integracao && base !== esteira.producao) return null
  return classificarPr({ base, head }, esteira)
}

const checkInvalid = (base, esteira) =>
  base === esteira.producao
    ? [`base ${base} só aceita ${esteira.prefixoHotfix}* (ou o FF do Promover para Prod)`]
    : [`base ${base} não aceita ${esteira.prefixoHotfix}* — hotfix vai para ${esteira.producao}`]

const checkHotfixUat = (body, action) => {
  const errors = checkUat(body, action)
  if (parseUat(body).approved) {
    errors.push('hotfix não passa pelo UAT: use "UAT não se aplica — <motivo>"')
  }
  return errors
}

const checkBackPromotion = (title) =>
  BACK_PROMOTION_TITLE.test(title)
    ? []
    : [
        `Título da back-promotion deve ser "chore(release): back-promotion de vX.Y.Z" (recebido: "${title}"). Edite o título do PR.`,
      ]

/**
 * Avisos (não bloqueiam) que o entrypoint imprime.
 * @param {{ base?: string, head?: string, esteira?: import('./esteira/config.mjs').Esteira | null }} input
 * @returns {string[]}
 */
export function avisosDoPr({ base, head, esteira }) {
  return classify(base, head, esteira) === 'back-promotion' ? [AVISO_MERGE_COMMIT] : []
}

/**
 * @param {{ title: string, body: string, action: string, fileExists: (path: string) => boolean, base?: string, head?: string, esteira?: import('./esteira/config.mjs').Esteira | null }} input
 * @returns {string[]} erros em pt-BR, cada um com a correção; `[]` = ok.
 */
export function checkPr({ title, body, action, fileExists, base, head, esteira }) {
  const kind = classify(base, head, esteira)
  if (kind === 'invalido') return checkInvalid(base, esteira)
  if (kind === 'back-promotion') return checkBackPromotion(title ?? '')
  const { parsed, errors: titleErrors } = checkTitle(title ?? '')
  const specErrors = checkSpec(body ?? '', parsed, fileExists)
  if (kind === 'feature') return [...titleErrors, ...specErrors]
  const uatErrors =
    kind === 'hotfix' ? checkHotfixUat(body ?? '', action) : checkUat(body ?? '', action)
  return [...titleErrors, ...specErrors, ...uatErrors]
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const { GITHUB_EVENT_PATH } = process.env
    if (!GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH é obrigatório')
    const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8'))
    const base = event.pull_request?.base?.ref
    const head = event.pull_request?.head?.ref
    const esteira = lerEsteira()
    const errors = checkPr({
      base,
      head,
      esteira,
      title: event.pull_request?.title ?? '',
      body: event.pull_request?.body ?? '',
      action: event.action ?? '',
      fileExists: (path) => existsSync(path),
    })
    for (const aviso of avisosDoPr({ base, head, esteira })) {
      process.stdout.write(`pr-gate: aviso — ${aviso}\n`)
    }
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
