// Índice de cenários e RNF do projeto (spec e2e-regressao-docs §8.1). `montarIndice` é puro;
// `loadIndice` lê o disco de forma **síncrona** e sem efeitos colaterais além de ler arquivos
// (e um `git ls-files`), para servir tanto ao `check-cenarios` quanto aos helpers de E2E.
// Nunca lança em entrada malformada: problemas vão para `erros`/`avisos` com `arquivo:linha`.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { globToRegExp } from '../template-sync/manifest.mjs'
import { parseCenarios } from './cenarios.mjs'
import { parseRnf } from './rnf.mjs'

export { globToRegExp }

export const CONFIG_PATH = 'tests/e2e/cenarios.config.json'

/** @typedef {import('./cenarios.mjs').Cenario} Cenario */
/** @typedef {import('./cenarios.mjs').Erro} Erro */
/** @typedef {Erro & { global?: boolean }} ErroIndice `global`: sempre erro (ex.: ID duplicado). */
/**
 * @typedef {{
 *   specs: string[], testes: string[], paginas: string[],
 *   appDir: string, ajuda: string, rnf: string
 * }} CenariosConfig
 */
/** @typedef {ReturnType<typeof parseRnf>} RnfIndice */
/**
 * @typedef {{
 *   config: CenariosConfig, cenarios: Map<string, Cenario>, rnf: RnfIndice,
 *   declarados: Map<string, { id: string, linha: number }[]>,
 *   erros: ErroIndice[], avisos: Erro[]
 * }} Indice
 */

/** Configuração do template (a mesma de `tests/e2e/cenarios.config.json`). */
export const DEFAULT_CONFIG = Object.freeze({
  specs: ['docs/superpowers/specs/*.md', 'examples/walking-skeleton/docs/specs/*.md'],
  testes: ['tests/e2e/**/*.spec.ts', 'examples/walking-skeleton/tests/e2e/**/*.spec.ts'],
  paginas: ['examples/walking-skeleton/src/app/**/page.tsx'],
  appDir: 'examples/walking-skeleton/src/app',
  ajuda: 'examples/walking-skeleton/docs/ajuda',
  rnf: 'docs/rnf.md',
})

const CONFIG_VAZIA = Object.freeze({
  specs: [],
  testes: [],
  paginas: [],
  appDir: '',
  ajuda: '',
  rnf: '',
})

const ID_REQUISITO = /\b(RNF-[A-Z]{3}-\d{3}|USA-\d{3})\b/g
const SPEC_TEMPLATE = '_TEMPLATE.md'

/**
 * Rota do Next.js App Router para um `page.tsx`: tira o `appDir`, os route groups `(grupo)` e o
 * nome do arquivo; mantém segmentos dinâmicos (`[id]`). A raiz vira `/`.
 * @param {string} path
 * @param {string} appDir
 * @returns {string}
 */
export const rotaDaPagina = (path, appDir) => {
  const base = appDir.replace(/\/+$/, '')
  const relativo = base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
  const segmentos = relativo
    .split('/')
    .slice(0, -1)
    .filter((s) => s && !/^\(.*\)$/.test(s))
  return `/${segmentos.join('/')}`
}

/**
 * IDs de RNF/USA citados na seção "Requisitos não funcionais" de uma spec (desvios do baseline).
 * @param {string} markdown
 * @returns {{ id: string, linha: number }[]}
 */
export const rnfsDeclarados = (markdown) => {
  const achados = []
  let naSecao = false
  markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((texto, i) => {
      if (/^## /.test(texto)) {
        naSecao = /requisitos não funcionais/i.test(texto)
        return
      }
      if (!naSecao) return
      for (const m of texto.matchAll(ID_REQUISITO)) {
        if (!achados.some((a) => a.id === m[1])) achados.push({ id: m[1], linha: i + 1 })
      }
    })
  return achados
}

/**
 * Monta o índice a partir de conteúdos já lidos. Puro.
 * @param {{
 *   config: CenariosConfig, specs: { path: string, markdown: string }[],
 *   rnf: { path: string, markdown: string } | null, avisos?: Erro[], erros?: ErroIndice[]
 * }} entrada
 * @returns {Indice}
 */
export const montarIndice = ({ config, specs, rnf, avisos = [], erros = [] }) => {
  /** @type {Map<string, Cenario>} */
  const cenarios = new Map()
  const declarados = new Map()
  const todosErros = [...erros]
  const todosAvisos = [...avisos]

  for (const { path, markdown } of specs) {
    const lido = parseCenarios(markdown, path)
    todosErros.push(...lido.erros)
    for (const c of lido.cenarios) {
      const anterior = cenarios.get(c.id)
      if (anterior) {
        todosErros.push({
          path: c.path,
          linha: c.linha,
          mensagem: `ID ${c.id} duplicado: já usado em ${anterior.path}:${anterior.linha} (IDs nunca se repetem; use o próximo número livre)`,
          global: true,
        })
      } else {
        cenarios.set(c.id, c)
      }
    }
    const rnfs = rnfsDeclarados(markdown)
    if (rnfs.length > 0) declarados.set(path, rnfs)
  }

  /** @type {RnfIndice} */
  let rnfIndice = { requisitos: [], telas: [], exclusoes: [], erros: [] }
  if (rnf) {
    rnfIndice = parseRnf(rnf.markdown, rnf.path)
    todosErros.push(...rnfIndice.erros.map((e) => ({ ...e, global: true })))
  } else {
    todosAvisos.push({
      path: config.rnf || 'docs/rnf.md',
      linha: 1,
      mensagem: 'baseline de RNF não encontrado: índice de RNF e telas vazio',
    })
  }

  return {
    config,
    cenarios,
    rnf: rnfIndice,
    declarados,
    erros: todosErros,
    avisos: todosAvisos,
  }
}

/**
 * Arquivos do repositório (versionados + novos não ignorados) que casam com algum glob.
 * @param {string} root
 * @param {string[]} globs
 * @returns {string[]}
 */
export const listarArquivos = (root, globs) => {
  if (globs.length === 0) return []
  const regexes = globs.map(globToRegExp)
  const saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return [...new Set(saida.split('\n').filter(Boolean))]
    .filter((p) => regexes.some((r) => r.test(p)) && existsSync(join(root, p)))
    .sort()
}

const ehListaDeTexto = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string')

/** @returns {{ config: CenariosConfig, erro: string | null, existe: boolean }} */
const lerConfig = (root) => {
  const arquivo = join(root, CONFIG_PATH)
  if (!existsSync(arquivo)) return { config: { ...CONFIG_VAZIA }, erro: null, existe: false }
  try {
    const json = JSON.parse(readFileSync(arquivo, 'utf8'))
    const ok =
      json &&
      ['specs', 'testes', 'paginas'].every((k) => ehListaDeTexto(json[k])) &&
      ['appDir', 'ajuda', 'rnf'].every((k) => typeof json[k] === 'string')
    if (!ok) {
      return {
        config: { ...CONFIG_VAZIA },
        erro: 'esperado { specs, testes, paginas: string[], appDir, ajuda, rnf: string }',
        existe: true,
      }
    }
    return { config: json, erro: null, existe: true }
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    return { config: { ...CONFIG_VAZIA }, erro: `JSON inválido (${motivo})`, existe: true }
  }
}

/**
 * Lê `tests/e2e/cenarios.config.json`, as specs e o baseline de RNF. Síncrono.
 * Sem config → índice vazio + aviso; sem `docs/rnf.md` → RNF vazio + aviso. Nunca lança.
 * @param {string} root
 * @returns {Indice}
 */
export const loadIndice = (root) => {
  const { config, erro, existe } = lerConfig(root)
  /** @type {Erro[]} */
  const avisos = []
  /** @type {ErroIndice[]} */
  const erros = []
  if (!existe) {
    avisos.push({
      path: CONFIG_PATH,
      linha: 1,
      mensagem: 'arquivo não encontrado: check de cenários não configurado neste projeto',
    })
    return { ...montarIndice({ config, specs: [], rnf: null, avisos, erros }), avisos }
  }
  if (erro) erros.push({ path: CONFIG_PATH, linha: 1, mensagem: erro, global: true })

  let caminhos = []
  try {
    caminhos = listarArquivos(root, config.specs).filter((p) => !p.endsWith(`/${SPEC_TEMPLATE}`))
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    erros.push({
      path: CONFIG_PATH,
      linha: 1,
      mensagem: `falha ao listar specs: ${motivo}`,
      global: true,
    })
  }
  const specs = caminhos.map((path) => ({ path, markdown: readFileSync(join(root, path), 'utf8') }))
  const rnfArquivo = config.rnf ? join(root, config.rnf) : ''
  const rnf =
    rnfArquivo && existsSync(rnfArquivo)
      ? { path: config.rnf, markdown: readFileSync(rnfArquivo, 'utf8') }
      : null
  return montarIndice({ config, specs, rnf, avisos, erros })
}
