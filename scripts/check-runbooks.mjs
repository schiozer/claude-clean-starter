// Valida o formato e o catálogo de runbooks (ADR-013).
// Uso: node scripts/check-runbooks.mjs [--strict] [dir=docs/runbooks]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const REQUIRED_RUNBOOKS = [
  'bootstrap-ambientes.md',
  'deploy-uat.md',
  'deploy-prod.md',
  'rollback.md',
  'migracao-banco.md',
  'segredos-e-env.md',
  'feature-flags.md',
  'mcp-habilitar-e-conectar.md',
  'spec-gate.md',
]
export const SECTIONS = [
  'Objetivo',
  'Pré-condições',
  'Pre-flight',
  'Passos',
  'Verificação final',
  'Rollback',
  'Registro',
]
const CATALOG_FILES = ['README.md', '_TEMPLATE.md']
const META_KEYS = ['Responsável', 'Última verificação', 'Ambientes']
const STEP_SECTIONS = ['Pre-flight', 'Passos', 'Rollback']
const VERIFY_SECTIONS = ['Passos', 'Rollback']
const ENVIRONMENTS = ['Dev', 'UAT', 'Prod']
// `<preencher`: entrada do projeto; `<gerado`: saída do bootstrap, gravada após executá-lo.
const PLACEHOLDERS = ['<preencher', '<gerado']
// Stubs do _TEMPLATE.md que precisam virar comando/resultado reais.
const TEMPLATE_STUBS = ['<comando>', '<esperado>']
// Comandos com classe mínima, independentemente da tag do passo (ADR-013 §2).
const MIN_CLASS_COMMANDS = [
  { name: 'gh pr merge', pattern: /gh pr merge/, min: 3 },
  { name: 'vercel env pull', pattern: /vercel env pull/, min: 3 },
  { name: 'git push --force', pattern: /git push[^`\n]*(--force|\s-f\b)/, min: 3 },
  { name: 'vercel rollback', pattern: /vercel rollback/, min: 2 },
  { name: 'vercel promote', pattern: /vercel promote/, min: 2 },
  { name: 'vercel deploy --prod', pattern: /vercel deploy[^`\n]*--prod/, min: 2 },
  { name: 'vercel project rm', pattern: /vercel project rm/, min: 2 },
  {
    name: 'neonctl branches delete/restore/reset',
    pattern: /neonctl branches (delete|restore|reset)/,
    min: 2,
  },
  { name: '--env .env.prod', pattern: /--env \.env\.prod/, min: 2 },
]
const FENCE = /^\s*(`{3,}|~{3,})/

function parse(markdown) {
  const meta = {}
  const sections = []
  let current = null
  let fence = null
  for (const text of markdown.split(/\r?\n/)) {
    const marker = FENCE.exec(text)?.[1]
    const closes =
      fence &&
      marker &&
      marker[0] === fence[0] &&
      marker.length >= fence.length &&
      text.trim() === marker
    const code = Boolean(fence || marker)
    if (closes) fence = null
    else if (!fence && marker) fence = marker
    if (!code) {
      const heading = /^## (.+?)\s*$/.exec(text)
      if (heading) {
        current = { title: heading[1], lines: [] }
        sections.push(current)
        continue
      }
      const metaLine = /^\*\*(.+?)\*\*:\s*(.*?)\s*$/.exec(text)
      if (!current && metaLine && META_KEYS.includes(metaLine[1])) {
        meta[metaLine[1]] = metaLine[2]
        continue
      }
    }
    if (current) current.lines.push({ text, code })
  }
  return { meta, sections }
}

// Item numerado de topo + continuação (linhas indentadas, em branco ou de código).
// Um parágrafo não indentado encerra o item.
function steps(section) {
  const items = []
  let open = false
  for (const { text, code } of section.lines) {
    if (!code && /^\d+\.\s/.test(text)) {
      items.push({ head: text, body: text })
      open = true
    } else if (open && (code || text.trim() === '' || /^\s/.test(text))) {
      items[items.length - 1].body += `\n${text}`
    } else if (text.trim() !== '') {
      open = false
    }
  }
  return items
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function checkMeta(meta, errors) {
  for (const key of META_KEYS) if (!meta[key]) errors.push(`metadado ausente: **${key}**`)
  if (!meta.Ambientes) return
  const envs = meta.Ambientes.split(',').map((env) => env.trim())
  const invalid = envs.filter((env) => !ENVIRONMENTS.includes(env))
  if (invalid.length) errors.push(`Ambientes inválidos: ${invalid.join(', ')} (use Dev, UAT, Prod)`)
  if (new Set(envs).size !== envs.length) errors.push('Ambientes repetidos')
}

function checkSections(sections, errors) {
  for (const { title } of sections) {
    if (!SECTIONS.includes(title)) errors.push(`seção desconhecida: ## ${title}`)
  }
  const titles = sections.map((s) => s.title).filter((t) => SECTIONS.includes(t))
  const missing = SECTIONS.filter((t) => !titles.includes(t))
  for (const title of missing) errors.push(`seção ausente: ## ${title}`)
  if (!missing.length && titles.join('|') !== SECTIONS.join('|')) {
    errors.push(`seções fora de ordem ou duplicadas; esperado: ${SECTIONS.join(' → ')}`)
  }
}

function checkSteps(sections, errors) {
  for (const section of sections.filter((s) => SECTIONS.includes(s.title))) {
    if (STEP_SECTIONS.includes(section.title)) continue
    if (section.lines.some(({ text, code }) => !code && /^\d+\.\s/.test(text))) {
      errors.push(
        `## ${section.title}: item numerado fora de Pre-flight/Passos/Rollback (use lista com "-")`
      )
    }
  }
  for (const section of sections.filter((s) => STEP_SECTIONS.includes(s.title))) {
    const items = steps(section)
    const malformed = section.lines.find(
      ({ text, code }) => !code && /^(\d+\)|[-*+])\s+\[R[0-3]\]/.test(text)
    )
    if (malformed) {
      errors.push(
        `## ${section.title}: passo fora do formato "N. [Rn]": ${malformed.text.trim().slice(0, 60)}`
      )
    }
    if (!items.length) errors.push(`## ${section.title}: nenhum passo numerado`)
    for (const item of items) {
      const label = `## ${section.title} › ${item.head.trim().slice(0, 60)}`
      const tag = /^\d+\.\s+\[R([0-3])\]/.exec(item.head)
      if (!tag) {
        errors.push(`${label}: passo sem classe de risco [R0]–[R3]`)
        continue
      }
      if ((item.body.match(/\[R[0-3]\]/g) ?? []).length > 1) {
        errors.push(`${label}: mais de uma classe de risco no passo`)
      }
      for (const command of MIN_CLASS_COMMANDS) {
        if (Number(tag[1]) >= command.min || !command.pattern.test(item.body)) continue
        const required = command.min === 3 ? '[R3] Humano:' : 'no mínimo [R2]'
        errors.push(`${label}: "${command.name}" exige ${required}`)
      }
      if (tag[1] === '3' && !/^\d+\.\s+\[R3\] Humano:/.test(item.head)) {
        errors.push(`${label}: passo [R3] deve começar com "[R3] Humano:"`)
      }
      if (VERIFY_SECTIONS.includes(section.title) && !item.body.includes('Verificar:')) {
        errors.push(`${label}: passo sem "Verificar:"`)
      }
    }
  }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function checkStrict(markdown, meta, errors) {
  markdown.split(/\r?\n/).forEach((line, index) => {
    for (const placeholder of PLACEHOLDERS) {
      if (line.includes(placeholder)) {
        errors.push(`linha ${index + 1}: placeholder ${placeholder}> pendente`)
      }
    }
    for (const stub of TEMPLATE_STUBS) {
      if (line.includes(stub)) errors.push(`linha ${index + 1}: stub ${stub} do template pendente`)
    }
  })
  const date = meta['Última verificação']
  if (date && !isIsoDate(date))
    errors.push(`Última verificação inválida: "${date}" (use AAAA-MM-DD)`)
  else if (date && date > today()) errors.push(`Última verificação no futuro: "${date}"`)
}

export function checkRunbook(markdown, { strict = false } = {}) {
  const errors = []
  const { meta, sections } = parse(markdown)
  checkMeta(meta, errors)
  checkSections(sections, errors)
  checkSteps(sections, errors)
  if (strict) checkStrict(markdown, meta, errors)
  return errors
}

export function checkCatalog(dir, { strict = false } = {}) {
  if (!existsSync(dir)) return [`${dir}: diretório de runbooks não encontrado`]
  const files = readdirSync(dir).filter((file) => file.endsWith('.md'))
  const errors = []
  for (const file of [...CATALOG_FILES, ...REQUIRED_RUNBOOKS]) {
    if (!files.includes(file)) errors.push(`${file}: arquivo obrigatório ausente do catálogo`)
  }
  for (const file of files.filter((f) => !CATALOG_FILES.includes(f)).sort()) {
    for (const error of checkRunbook(readFileSync(join(dir, file), 'utf8'), { strict })) {
      errors.push(`${file}: ${error}`)
    }
  }
  return errors
}

function main(argv) {
  const strict = argv.includes('--strict')
  const dir = resolve(argv.find((arg) => !arg.startsWith('--')) ?? 'docs/runbooks')
  const mode = strict ? ' (modo estrito)' : ''
  const errors = checkCatalog(dir, { strict })
  if (errors.length) {
    console.error(`check-runbooks: ${errors.length} problema(s)${mode}`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  console.log(`check-runbooks: ok${mode}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2))
}
