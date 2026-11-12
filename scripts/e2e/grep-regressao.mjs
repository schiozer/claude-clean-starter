#!/usr/bin/env node
// Filtro `--grep` do job `Regressão (UAT)` (spec e2e-regressao-docs §8.2): `@regressao` + os
// cenários novos ou alterados nas specs do PR (diff com `origin/<base>`, como as páginas novas do
// `check-cenarios`). A CLI escreve só `grep=<…>` em `$GITHUB_OUTPUT`.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCenarios } from './cenarios.mjs'
import { globToRegExp, loadIndice } from './config.mjs'

export const TAG_REGRESSAO = '@regressao'

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @param {string[]} ids
 * @returns {string}
 */
export const montarGrep = (ids) =>
  [TAG_REGRESSAO, ...new Set(ids)].map((s, i) => (i === 0 ? s : escaparRegex(s))).join('|')

/** Conteúdo que, se mudar, faz o cenário rodar de novo (o resto da spec não conta). */
const assinatura = (c) =>
  JSON.stringify([c.titulo, c.tipo, c.destinos, c.passos.map((p) => [p.palavra, p.texto])])

/**
 * IDs dos cenários novos ou alterados (título, tipo, destinos ou passos) em cada spec do PR,
 * sem os aposentados nem os fora da regressão. `base: null` = spec nova.
 * @param {{ path: string, head: string, base: string | null }[]} specs
 * @returns {string[]}
 */
export const cenariosAlterados = (specs) => {
  const ids = []
  for (const { path, head, base } of specs) {
    const antes = new Map(
      base === null ? [] : parseCenarios(base, path).cenarios.map((c) => [c.id, assinatura(c)])
    )
    for (const c of parseCenarios(head, path).cenarios) {
      if (c.aposentado !== null || c.foraDaRegressao !== null) continue
      if (antes.get(c.id) !== assinatura(c)) ids.push(c.id)
    }
  }
  return [...new Set(ids)]
}

// ---------------------------------------------------------------- CLI

const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** Specs adicionadas/alteradas no PR, com o conteúdo da base (ou `null` se nova). */
const specsDoPr = (root, base, globs) => {
  const regexes = globs.map(globToRegExp)
  const saida = git(root, ['diff', '--name-only', '--diff-filter=AMR', `origin/${base}...HEAD`])
  return saida
    .split('\n')
    .filter((p) => p && !p.endsWith('/_TEMPLATE.md') && regexes.some((r) => r.test(p)))
    .map((path) => {
      let anterior = null
      try {
        anterior = git(root, ['show', `origin/${base}:${path}`])
      } catch {
        anterior = null // arquivo não existe na base: spec nova
      }
      return { path, head: readFileSync(join(root, path), 'utf8'), base: anterior }
    })
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const root = process.cwd()
  const { GITHUB_BASE_REF, GITHUB_OUTPUT } = process.env
  let ids = []
  try {
    if (GITHUB_BASE_REF) {
      ids = cenariosAlterados(specsDoPr(root, GITHUB_BASE_REF, loadIndice(root).config.specs))
    }
  } catch (error) {
    // nunca derruba a regressão: sem o diff, roda só `@regressao`.
    const motivo = error instanceof Error ? error.message.split('\n')[0] : String(error)
    process.stderr.write(`grep-regressao: aviso — sem cenários do PR (${motivo})\n`)
  }
  const grep = montarGrep(ids)
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `grep=${grep}\n`)
  process.stdout.write(`grep-regressao: ${grep}\n`)
}
