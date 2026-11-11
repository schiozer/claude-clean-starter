#!/usr/bin/env node
// Check "Cenários × testes" (spec e2e-regressao-docs §8.1): roda como passo do job `PR gate`.
// Cruza os cenários das specs, os testes Playwright (varredura estática), as páginas de ajuda e
// as telas do `docs/rnf.md`. Erro bloqueia o que é da spec do PR (ou página nova do PR); o resto
// vira aviso. Órfãos e IDs duplicados são sempre erro. Gera o relatório de rastreabilidade.

import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globToRegExp, listarArquivos, loadIndice, rotaDaPagina } from './e2e/config.mjs'
import { diffPassos, normalizarPasso } from './e2e/cenarios.mjs'
import { scanTestes } from './e2e/testes.mjs'
import { parseSpecLine } from './pr-gate.mjs'

export const RELATORIO_PATH = '.e2e/rastreabilidade.md'

/** @typedef {import('./e2e/cenarios.mjs').Cenario} Cenario */
/** @typedef {import('./e2e/cenarios.mjs').Erro} Erro */
/** @typedef {import('./e2e/testes.mjs').TesteRef} TesteRef */
/** @typedef {import('./e2e/config.mjs').Indice} Indice */
/**
 * Página de ajuda gerada por `docs:gerar` em `<ajuda>/<CTX>/<ID>.json`.
 * @typedef {{
 *   id: string, titulo: string, perfil: string, passos: { texto: string, imagem: string }[]
 * }} AjudaDoc
 */

const local = (path, linha) => (linha ? `${path}:${linha}` : path)

const celula = (texto) => texto.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/**
 * @param {{
 *   indice: Indice, refs: TesteRef[], ajudaFiles: Map<string, AjudaDoc>, paginas: string[],
 *   specDoPr: string | null, paginasNovas: string[], errosLeitura?: Erro[]
 * }} entrada `errosLeitura`: problemas ao ler testes/ajuda (sempre erro).
 * @returns {{ erros: string[], avisos: string[], relatorio: string }}
 */
export function checkCenarios({
  indice,
  refs,
  ajudaFiles,
  paginas,
  specDoPr,
  paginasNovas,
  errosLeitura = [],
}) {
  /** @type {string[]} */
  const erros = []
  /** @type {string[]} */
  const avisos = []
  const daSpec = (path) => specDoPr !== null && path === specDoPr
  const reportar = (bloqueia, path, linha, mensagem) =>
    (bloqueia ? erros : avisos).push(`${local(path, linha)}: ${mensagem}`)

  for (const e of indice.erros) reportar(e.global || daSpec(e.path), e.path, e.linha, e.mensagem)
  for (const a of indice.avisos) reportar(false, a.path, a.linha, a.mensagem)
  for (const e of errosLeitura) reportar(true, e.path, e.linha, e.mensagem)

  /** @type {Map<string, TesteRef[]>} */
  const refsPorId = new Map()
  for (const r of refs) refsPorId.set(r.id, [...(refsPorId.get(r.id) ?? []), r])

  const requisitos = new Set(indice.rnf.requisitos.map((r) => r.id))
  for (const rnfs of indice.declarados.values()) for (const r of rnfs) requisitos.add(r.id)

  /** @type {Map<string, string[]>} situação por cenário (vazio = ok) */
  const situacao = new Map()

  for (const r of refs) {
    const c = indice.cenarios.get(r.id)
    if (!c) {
      if (!requisitos.has(r.id)) {
        reportar(
          true,
          r.path,
          r.linha,
          `teste órfão: ${r.id} não existe como cenário, RNF ou USA em nenhuma spec nem no baseline`
        )
      }
      continue
    }
    const problemas = situacao.get(c.id) ?? []
    situacao.set(c.id, problemas)
    const bloqueia = daSpec(c.path)
    if (c.aposentado !== null) {
      reportar(
        bloqueia,
        r.path,
        r.linha,
        `teste de ${c.id}, cenário aposentado (${c.aposentado}): remova o teste`
      )
      problemas.push('teste de cenário aposentado')
      continue
    }
    const esperado = c.passos.map((p) => normalizarPasso(p.texto))
    if (r.passos === null) {
      if (c.tipo === '@e2e') {
        reportar(
          bloqueia,
          r.path,
          r.linha,
          `${c.id} (@e2e) não usa jornada(): os passos do cenário não são conferidos`
        )
        problemas.push('passos divergentes')
      }
    } else {
      const diff = diffPassos(esperado, r.passos)
      if (diff) {
        reportar(
          bloqueia,
          r.path,
          r.linha,
          `passos de ${c.id} diferem de ${local(c.path, c.linha)} — ${diff}`
        )
        problemas.push('passos divergentes')
      }
    }
    const tagsEsperadas = [c.tipo, ...c.destinos]
    const faltando = tagsEsperadas.filter((t) => !r.tags.includes(t))
    const sobrando = r.tags.filter((t) => !tagsEsperadas.includes(t))
    if (faltando.length > 0 || sobrando.length > 0) {
      const partes = []
      if (faltando.length > 0) partes.push(`faltando: ${faltando.join(', ')}`)
      if (sobrando.length > 0) partes.push(`sobrando: ${sobrando.join(', ')}`)
      reportar(
        bloqueia,
        r.path,
        r.linha,
        `tags de ${c.id} diferem do tipo/destinos do cenário — ${partes.join('; ')}`
      )
      problemas.push('tag divergente')
    }
  }

  for (const c of indice.cenarios.values()) {
    const problemas = situacao.get(c.id) ?? []
    situacao.set(c.id, problemas)
    if (c.aposentado !== null) continue
    const bloqueia = daSpec(c.path)
    if (c.destinos.includes('@regressao') && !refsPorId.has(c.id)) {
      reportar(bloqueia, c.path, c.linha, `cenário ${c.id} (@regressao) sem teste com o mesmo ID`)
      problemas.push('sem teste')
    }
    if (c.destinos.includes('@doc')) {
      const doc = ajudaFiles.get(c.id)
      if (!doc) {
        reportar(
          bloqueia,
          c.path,
          c.linha,
          `cenário ${c.id} (@doc) sem página de ajuda (${c.id}.json): rode npm run docs:gerar`
        )
        problemas.push('doc ausente')
      } else {
        const diff = diffPassos(
          c.passos.map((p) => normalizarPasso(p.texto)),
          doc.passos.map((p) => normalizarPasso(p.texto))
        )
        if (diff) {
          reportar(
            bloqueia,
            c.path,
            c.linha,
            `página de ajuda de ${c.id} com passos diferentes — ${diff}`
          )
          problemas.push('doc divergente')
        }
      }
    }
  }

  for (const [path, rnfs] of indice.declarados) {
    for (const r of rnfs) {
      if (!refsPorId.has(r.id)) {
        reportar(daSpec(path), path, r.linha, `${r.id} declarado na spec sem teste com o mesmo ID`)
      }
    }
  }

  const rotasConhecidas = new Set([...indice.rnf.telas.map((t) => t.rota), ...indice.rnf.exclusoes])
  for (const p of paginas) {
    const rota = rotaDaPagina(p, indice.config.appDir)
    if (rotasConhecidas.has(rota)) continue
    reportar(
      paginasNovas.includes(p),
      p,
      0,
      `página '${rota}' fora das telas e exclusões de ${indice.config.rnf || 'docs/rnf.md'}: adicione-a em "Telas principais" ou em "Exclusões"`
    )
  }

  return { erros, avisos, relatorio: montarRelatorio(indice, refsPorId, ajudaFiles, situacao) }
}

/**
 * @param {Indice} indice
 * @param {Map<string, TesteRef[]>} refsPorId
 * @param {Map<string, AjudaDoc>} ajudaFiles
 * @param {Map<string, string[]>} situacao
 */
const montarRelatorio = (indice, refsPorId, ajudaFiles, situacao) => {
  const cenarios = [...indice.cenarios.values()].sort((a, b) => a.id.localeCompare(b.id))
  const linhas = [
    '## Rastreabilidade — cenários × testes',
    '',
    '| Cenário | Critério | Teste | Doc | Situação |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const c of cenarios) {
    const testes = (refsPorId.get(c.id) ?? []).map((r) => local(r.path, r.linha)).join(', ') || '—'
    const doc = !c.destinos.includes('@doc') ? '—' : ajudaFiles.has(c.id) ? 'ok' : 'falta'
    const problemas = situacao.get(c.id) ?? []
    const estado =
      c.aposentado !== null
        ? ['aposentado', ...problemas].join(', ')
        : problemas.length > 0
          ? problemas.join(', ')
          : c.foraDaRegressao !== null
            ? 'fora da regressão'
            : 'ok'
    linhas.push(
      `| ${[`${c.id} — ${c.titulo}`, c.criterios.join(', ') || '—', testes, doc, estado].map(celula).join(' | ')} |`
    )
  }
  if (cenarios.length === 0) linhas.push('', '_Nenhum cenário encontrado nas specs._')
  return `${linhas.join('\n')}\n`
}

// ---------------------------------------------------------------- CLI

const mensagemDe = (error) => (error instanceof Error ? error.message : String(error))

/** @returns {{ ajudaFiles: Map<string, AjudaDoc>, erros: Erro[] }} */
const lerAjuda = (root, dir) => {
  /** @type {Map<string, AjudaDoc>} */
  const ajudaFiles = new Map()
  /** @type {Erro[]} */
  const erros = []
  if (!dir || !existsSync(join(root, dir))) return { ajudaFiles, erros }
  for (const path of listarArquivos(root, [`${dir.replace(/\/+$/, '')}/**/*.json`])) {
    try {
      const json = JSON.parse(readFileSync(join(root, path), 'utf8'))
      const ok =
        json &&
        typeof json.id === 'string' &&
        Array.isArray(json.passos) &&
        json.passos.every((p) => p && typeof p.texto === 'string')
      if (!ok)
        erros.push({
          path,
          linha: 1,
          mensagem: 'página de ajuda inválida: esperado { id, passos: [{ texto, imagem }] }',
        })
      else ajudaFiles.set(json.id, json)
    } catch (error) {
      erros.push({
        path,
        linha: 1,
        mensagem: `página de ajuda com JSON inválido (${mensagemDe(error)})`,
      })
    }
  }
  return { ajudaFiles, erros }
}

/** Spec do PR: corpo do evento (`Spec:`) no CI; `--spec <path>` localmente. */
const resolverSpec = (argv, env, avisos) => {
  if (env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    const spec = parseSpecLine(event.pull_request?.body ?? '')
    if (spec.kind === 'path') return spec.path
    if (spec.kind === 'error')
      avisos.push(`linha Spec: do PR inválida (${spec.message}): só checagens globais`)
    return null
  }
  const i = argv.indexOf('--spec')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null
}

const paginasNovasDoPr = (root, base, globs, avisos) => {
  if (!base) return []
  try {
    const saida = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=A', `origin/${base}...HEAD`],
      { cwd: root, encoding: 'utf8' }
    )
    const regexes = globs.map(globToRegExp)
    return saida.split('\n').filter((p) => p && regexes.some((r) => r.test(p)))
  } catch (error) {
    avisos.push(
      `não foi possível listar as páginas novas do PR (${mensagemDe(error).split('\n')[0]})`
    )
    return []
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const root = process.cwd()
    const avisosCli = []
    const indice = loadIndice(root)
    const { config } = indice
    const specDoPr = resolverSpec(process.argv.slice(2), process.env, avisosCli)
    if (specDoPr && !existsSync(join(root, specDoPr))) {
      avisosCli.push(`a spec do PR "${specDoPr}" não existe`)
    }

    const refs = []
    const errosLeitura = []
    for (const path of listarArquivos(root, config.testes)) {
      const lido = scanTestes(readFileSync(join(root, path), 'utf8'), path)
      refs.push(...lido.refs)
      errosLeitura.push(...lido.erros)
    }
    const ajuda = lerAjuda(root, config.ajuda)
    errosLeitura.push(...ajuda.erros)

    const resultado = checkCenarios({
      indice,
      refs,
      ajudaFiles: ajuda.ajudaFiles,
      paginas: listarArquivos(root, config.paginas),
      specDoPr,
      paginasNovas: paginasNovasDoPr(root, process.env.GITHUB_BASE_REF, config.paginas, avisosCli),
      errosLeitura,
    })
    const avisos = [...avisosCli, ...resultado.avisos]

    mkdirSync(join(root, '.e2e'), { recursive: true })
    writeFileSync(join(root, RELATORIO_PATH), resultado.relatorio)
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resultado.relatorio}\n`)
    }

    const alvo = specDoPr ? `spec do PR: ${specDoPr}` : 'sem spec do PR: só checagens globais'
    if (avisos.length > 0) {
      process.stdout.write(
        `check-cenarios: ${avisos.length} aviso(s):\n${avisos.map((a) => `- ${a}`).join('\n')}\n`
      )
    }
    if (resultado.erros.length === 0) {
      process.stdout.write(
        `check-cenarios: ok (${alvo}; ${indice.cenarios.size} cenário(s), ${refs.length} teste(s)). Relatório em ${RELATORIO_PATH}.\n`
      )
    } else {
      process.stderr.write(
        `check-cenarios: ${resultado.erros.length} erro(s) (${alvo}):\n${resultado.erros.map((e) => `- ${e}`).join('\n')}\n` +
          'Corrija a spec, o teste ou a página de ajuda; o relatório está em .e2e/rastreabilidade.md.\n'
      )
      process.exit(1)
    }
  } catch (error) {
    process.stderr.write(`check-cenarios: erro — ${mensagemDe(error)}\n`)
    process.exit(1)
  }
}
