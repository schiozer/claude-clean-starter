// Inventário de IA do repositório em CycloneDX 1.6 (AI-BOM).
// Determinístico: sem timestamp, componentes ordenados, serialNumber derivado do conteúdo.
// Nunca lê `.claude/settings.local.json` (é pessoal). Workflows lidos por regex (sem YAML).

import { createHash } from 'node:crypto'

const SETTINGS = '.claude/settings.json'
const SKILLS_DIR = '.claude/skills'
const WORKFLOWS_DIR = '.github/workflows'

const parseJson = (texto) => {
  if (texto === null) return {}
  try {
    const valor = JSON.parse(texto)
    return typeof valor === 'object' && valor !== null ? valor : {}
  } catch {
    return {}
  }
}

function frontmatter(texto) {
  const achado = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto ?? '')
  const campos = {}
  if (!achado) return campos
  for (const linha of achado[1].split(/\r?\n/)) {
    const par = /^(name|description):\s*(.*)$/.exec(linha)
    if (par) campos[par[1]] = par[2].trim().replace(/^["']|["']$/g, '')
  }
  return campos
}

function coletarPlugins(settings) {
  const plugins = settings.enabledPlugins
  if (typeof plugins !== 'object' || plugins === null) return []
  return Object.entries(plugins)
    .filter(([, ativo]) => ativo === true)
    .map(([chave]) => {
      const arroba = chave.indexOf('@')
      return { nome: chave, grupo: arroba > 0 ? chave.slice(arroba + 1) : undefined }
    })
}

function coletarHooks(settings) {
  const hooks = settings.hooks
  if (typeof hooks !== 'object' || hooks === null) return []
  const porNome = new Map()
  for (const [evento, blocos] of Object.entries(hooks)) {
    if (!Array.isArray(blocos)) continue
    for (const bloco of blocos) {
      const matcher = bloco?.matcher ? bloco.matcher : '*'
      const comandos = (Array.isArray(bloco?.hooks) ? bloco.hooks : [])
        .map((h) => h?.command)
        .filter((c) => typeof c === 'string')
      const nome = `${evento}:${matcher}`
      const existente = porNome.get(nome)
      if (existente) existente.comandos.push(...comandos)
      else porNome.set(nome, { nome, comandos })
    }
  }
  const lista = [...porNome.values()]
  return lista
}

function coletarSkills(fs) {
  return fs
    .list(SKILLS_DIR)
    .map((pasta) => {
      const texto = fs.readFile(`${SKILLS_DIR}/${pasta}/SKILL.md`)
      if (texto === null) return null
      const fm = frontmatter(texto)
      return { nome: fm.name || pasta, descricao: fm.description }
    })
    .filter(Boolean)
}

function dedupeActions(actions) {
  const unicas = new Map()
  for (const a of actions) unicas.set(`${a.nome}|${a.sha ?? a.versao}`, a)
  const lista = [...unicas.values()]
  const contagem = new Map()
  for (const a of lista) contagem.set(a.nome, (contagem.get(a.nome) ?? 0) + 1)
  return lista.map((a) => ({
    ...a,
    ref: contagem.get(a.nome) > 1 ? `${a.nome}@${a.sha ? a.sha.slice(0, 7) : a.versao}` : a.nome,
  }))
}

function coletarWorkflows(fs) {
  const actions = []
  const modelos = []
  const arquivos = fs.list(WORKFLOWS_DIR).filter((n) => /\.ya?ml$/.test(n))
  for (const arquivo of arquivos) {
    const texto = fs.readFile(`${WORKFLOWS_DIR}/${arquivo}`) ?? ''
    const usos = /^[ \t]*-?[ \t]*uses:[ \t]*([\w.-]+\/[\w./-]+)@(\S+)(?:[ \t]+#[ \t]*(v\d\S*))?/gm
    for (const m of texto.matchAll(usos)) {
      if (!/claude|anthropic/i.test(m[1])) continue
      const ehSha = /^[0-9a-f]{40}$/.test(m[2])
      actions.push({ nome: m[1], versao: ehSha ? (m[3] ?? m[2]) : m[2], sha: ehSha ? m[2] : null })
    }
    for (const m of texto.matchAll(/(?:\|\|\s*|--model\s+)['"]?(claude-[\w.-]+)/g)) {
      modelos.push(m[1])
    }
  }
  return { actions: dedupeActions(actions), modelos: [...new Set(modelos)] }
}

/**
 * @param {{ readFile(p: string): string | null, list(dir: string): string[] }} fs
 */
export function coletar(fs) {
  const settings = parseJson(fs.readFile(SETTINGS))
  const { actions, modelos } = coletarWorkflows(fs)
  return {
    plugins: coletarPlugins(settings),
    skills: coletarSkills(fs),
    hooks: coletarHooks(settings),
    actions,
    modelos,
  }
}

const sha256 = (texto) => createHash('sha256').update(texto).digest('hex')

function uuidDe(texto) {
  const h = sha256(texto)
  const variante = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const porTipoNome = (a, b) => comparar(a.type, b.type) || comparar(a.name, b.name)

function montarComponentes(c) {
  const lista = []
  for (const p of c.plugins) {
    lista.push({
      type: 'application',
      'bom-ref': `plugin:${p.nome}`,
      name: p.nome,
      ...(p.grupo ? { group: p.grupo } : {}),
    })
  }
  for (const s of c.skills) {
    lista.push({
      type: 'application',
      'bom-ref': `skill:${s.nome}`,
      name: s.nome,
      ...(s.descricao ? { description: s.descricao } : {}),
    })
  }
  for (const h of c.hooks) {
    lista.push({
      type: 'application',
      'bom-ref': `hook:${h.nome}`,
      name: h.nome,
      properties: h.comandos.map((value) => ({ name: 'command', value })),
    })
  }
  for (const a of c.actions) {
    lista.push({
      type: 'application',
      'bom-ref': `action:${a.ref}`,
      name: a.nome,
      version: a.versao,
      ...(a.sha ? { hashes: [{ alg: 'SHA-1', content: a.sha }] } : {}),
    })
  }
  for (const nome of c.modelos) {
    lista.push({ type: 'machine-learning-model', 'bom-ref': `model:${nome}`, name: nome })
  }
  return lista.sort(porTipoNome)
}

function montarServicos(c, cfg) {
  const nomes = []
  if (cfg?.ativo === true || c.actions.length > 0 || c.modelos.length > 0) {
    nomes.push('Anthropic API')
  }
  if (cfg?.ativo === true) nomes.push('Grafana Cloud', 'Neon')
  return nomes.map((name) => ({ 'bom-ref': `service:${name}`, name }))
}

/**
 * @param {ReturnType<typeof coletar>} componentes
 * @param {{ ativo?: boolean }} cfg
 * @returns {any}
 */
export function gerarBom(componentes, cfg) {
  const servicos = montarServicos(componentes, cfg)
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      tools: { components: [{ type: 'application', name: 'scripts/ai-bom.mjs' }] },
    },
    components: montarComponentes(componentes),
    ...(servicos.length > 0 ? { services: servicos } : {}),
  }
  const serialNumber = `urn:uuid:${uuidDe(JSON.stringify(bom))}`
  return { bomFormat: bom.bomFormat, specVersion: bom.specVersion, serialNumber, ...bom }
}

/** @param {object} bom */
export const serializar = (bom) => `${JSON.stringify(bom, null, 2)}\n`
