#!/usr/bin/env node
// CLI da camada de deploy: `node scripts/deploy/index.mjs <op>` (spec camada-de-deploy).
// Cada operação devolve pares chave=valor que a CLI grava em `$GITHUB_OUTPUT`.

import { appendFileSync, realpathSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeGithubClient } from '../github-api.mjs'
import { lerDeployConfig } from './config.mjs'
import { waitPreview } from './aguardar.mjs'
import vercel from './hosts/vercel.mjs'
import heroku from './hosts/heroku.mjs'
import cloudrun from './hosts/cloudrun.mjs'

export const OPERACOES = ['host', 'credenciais', 'preview', 'prod', 'encerrar', 'aguardar']

const ADAPTADORES = { vercel, heroku, cloudrun }

export function adaptador(host) {
  const adapter = ADAPTADORES[host]
  if (!adapter) throw new Error(`deploy: adaptador '${host}' não implementado`)
  return adapter
}

const exigir = (env, nome) => {
  if (!env[nome]) throw new Error(`deploy: variável ${nome} é obrigatória`)
  return env[nome]
}

const numeroDoPr = (env) => {
  const texto = env.PR_NUMBER ?? ''
  if (!/^[1-9]\d*$/.test(texto)) {
    throw new Error(`deploy: PR_NUMBER deve ser um inteiro positivo (recebido '${texto}')`)
  }
  return Number(texto)
}

function credenciais(config, env) {
  if (config.host !== 'cloudrun') return {}
  const ambiente = env.DEPLOY_AMBIENTE
  if (ambiente !== 'uat' && ambiente !== 'prod') {
    throw new Error("deploy: DEPLOY_AMBIENTE deve ser 'uat' ou 'prod'")
  }
  const { region, [ambiente]: bloco } = config.cloudrun
  return {
    wifProvider: bloco.wifProvider,
    serviceAccount: bloco.serviceAccount,
    project: bloco.project,
    region,
  }
}

/** @returns {Promise<Record<string,string>>} */
export async function executar(
  operacao,
  { env = process.env, raiz = process.cwd(), exec, github } = {}
) {
  if (!OPERACOES.includes(operacao)) {
    throw new Error(`deploy: operação '${operacao}' inválida (válidas: ${OPERACOES.join(', ')})`)
  }
  const config = lerDeployConfig(raiz)
  if (operacao === 'host') return { host: config.host }
  if (operacao === 'credenciais') return credenciais(config, env)

  const adapter = adaptador(config.host)
  const log = (msg) => process.stdout.write(`deploy: ${msg}\n`)

  if (operacao === 'aguardar') {
    const sha = exigir(env, 'PREVIEW_SHA')
    const ctx = { config, sha, exec, github, log }
    if (!adapter.aguardarPreview && !github) {
      throw new Error('deploy: GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios para aguardar')
    }
    const url = adapter.aguardarPreview
      ? await adapter.aguardarPreview(ctx)
      : (
          await waitPreview({
            api: github,
            sha,
            ambienteDePreview: adapter.ambienteDePreview,
          })
        ).url
    return { url }
  }

  const sha = exigir(env, 'DEPLOY_SHA')
  const pr = operacao === 'prod' ? undefined : numeroDoPr(env)
  const ctx = { config, pr, sha, exec, github, log }
  if (operacao === 'preview') await adapter.deployPreview(ctx)
  else if (operacao === 'prod') await adapter.deployProd(ctx)
  else await adapter.encerrarPreview(ctx)
  return {}
}

const execReal = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error)
        reject(new Error(`deploy: '${cmd}' falhou: ${String(stderr).trim() || error.message}`))
      else resolve(String(stdout))
    })
  })

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_OUTPUT } = process.env
    const github =
      GITHUB_TOKEN && GITHUB_REPOSITORY
        ? makeGithubClient({
            token: GITHUB_TOKEN,
            repository: GITHUB_REPOSITORY,
            apiUrl: GITHUB_API_URL,
            userAgent: 'deploy-cli',
          })
        : undefined
    const saida = await executar(process.argv[2], { exec: execReal, github })
    for (const [chave, valor] of Object.entries(saida)) {
      if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `${chave}=${valor}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
