#!/usr/bin/env node
// CLI da esteira para os workflows: `node scripts/esteira/index.mjs <op>` (spec
// esteira-build-once-promote). Sem segredos: só lê `hooks/protect-main/config.json`.
// `ativa` → `ativa=true|false`, `integracao=<branch>`, `producao=<branch>` (vazios sem esteira),
// gravados em `$GITHUB_OUTPUT` quando definido; senão no stdout.

import { appendFileSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lerEsteira } from './config.mjs'

export const OPERACOES = ['ativa']

/**
 * @param {string} operacao
 * @param {{ raiz?: string }} [opcoes]
 * @returns {Record<string, string>}
 */
export function executar(operacao, { raiz = process.cwd() } = {}) {
  if (!OPERACOES.includes(operacao)) {
    throw new Error(`esteira: operação '${operacao}' inválida (válidas: ${OPERACOES.join(', ')})`)
  }
  const temConfig = existsSync(join(raiz, 'hooks/protect-main/config.json'))
  const esteira = temConfig ? lerEsteira(raiz) : null
  if (!esteira) return { ativa: 'false', integracao: '', producao: '' }
  return { ativa: 'true', integracao: esteira.integracao, producao: esteira.producao }
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const linhas = Object.entries(executar(process.argv[2]))
      .map(([chave, valor]) => `${chave}=${valor}\n`)
      .join('')
    const { GITHUB_OUTPUT } = process.env
    if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, linhas)
    else process.stdout.write(linhas)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
