#!/usr/bin/env node
// CLI da camada de deploy: `node scripts/deploy/index.mjs <op>` (spec camada-de-deploy).
// Cada operação devolve pares chave=valor que a CLI grava em `$GITHUB_OUTPUT`.

import { appendFileSync, existsSync, realpathSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeGithubClient } from '../github-api.mjs'
import { lerDeployConfig } from './config.mjs'
import { waitPreview } from './aguardar.mjs'
import vercel from './hosts/vercel.mjs'
import heroku, { urlDoReviewApp } from './hosts/heroku.mjs'
import { lerConfigAuth0, obterToken, registrarUrl, removerUrl } from './auth0Callbacks.mjs'
import cloudrun from './hosts/cloudrun.mjs'
import { registrar } from './githubDeployments.mjs'
import { lerEsteira } from '../esteira/config.mjs'

export const OPERACOES = [
  'host',
  'credenciais',
  'preview',
  'prod',
  'encerrar',
  'aguardar',
  'uat',
  'promover',
]

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

/** Esteira do repositório; sem `hooks/protect-main/config.json` (ex.: testes), desligada. */
const esteiraDe = (raiz) =>
  existsSync(join(raiz, 'hooks/protect-main/config.json')) ? lerEsteira(raiz) : null

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

// Auth0 de UAT só para Heroku (Cloud Run/Vercel usam curinga nos runbooks). Sem as quatro
// variáveis AUTH0_*, pula; com algumas, lerConfigAuth0 falha nomeando as que faltam.
async function sincronizarAuth0({ acao, url, auth0, log, fetchFn }) {
  if (!auth0) return log('Auth0 não configurado (AUTH0_*): pulando o registro da URL')
  const token = await obterToken({
    dominio: auth0.dominio,
    clientId: auth0.mgmtClientId,
    clientSecret: auth0.mgmtClientSecret,
    fetchFn,
  })
  const args = {
    dominio: auth0.dominio,
    clientId: auth0.clientId,
    token,
    url,
    callbackPath: auth0.callbackPath,
    fetchFn,
  }
  const { alterado } = await (acao === 'registrar' ? registrarUrl(args) : removerUrl(args))
  const verbo = acao === 'registrar' ? 'registrada' : 'removida'
  log(alterado ? `URL ${verbo} no Auth0: ${url}` : `Auth0 já estava em dia para ${url}`)
}

/**
 * @param {string} operacao
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   raiz?: string,
 *   exec?: (cmd: string, args: string[], opts?: { env?: Record<string, string> }) => Promise<string>,
 *   github?: Pick<ReturnType<typeof makeGithubClient>, 'call'> &
 *     Partial<Pick<ReturnType<typeof makeGithubClient>, 'location'>>,
 *   fetchFn?: typeof fetch,
 * }} [opcoes]
 * @returns {Promise<Record<string,string>>}
 */
export async function executar(
  operacao,
  { env = process.env, raiz = process.cwd(), exec, github, fetchFn = globalThis.fetch } = {}
) {
  if (!OPERACOES.includes(operacao)) {
    throw new Error(`deploy: operação '${operacao}' inválida (válidas: ${OPERACOES.join(', ')})`)
  }
  const esteira = esteiraDe(raiz)
  if (operacao === 'promover') {
    // import tardio: promover.mjs usa este módulo (adaptador, execReal).
    const { executarPromocao } = await import('../esteira/promover.mjs')
    const { promovido, sha, tag } = await executarPromocao({ raiz, env, fetchFn, rodar: exec })
    return { promovido: String(promovido), ...(sha ? { sha } : {}), ...(tag ? { tag } : {}) }
  }
  const config = lerDeployConfig(raiz, { esteira })
  if (operacao === 'host') return { host: config.host }
  if (operacao === 'credenciais') return credenciais(config, env)

  const adapter = adaptador(config.host)
  const log = (msg) => process.stdout.write(`deploy: ${msg}\n`)

  if (operacao === 'aguardar') {
    const sha = exigir(env, 'PREVIEW_SHA')
    const pr = adapter.aguardarPreview ? numeroDoPr(env) : undefined
    const ctx = { config, pr, sha, exec, github, log, env }
    if (!adapter.aguardarPreview && !github) {
      throw new Error('deploy: GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios para aguardar')
    }
    // Config parcial do Auth0 falha antes da espera (minutos), não depois dela.
    const auth0 = config.host === 'heroku' ? lerConfigAuth0(env) : undefined
    const url = adapter.aguardarPreview
      ? await adapter.aguardarPreview(ctx)
      : (
          await waitPreview({
            api: github,
            sha,
            ambienteDePreview: adapter.ambienteDePreview,
          })
        ).url
    if (config.host === 'heroku') {
      await sincronizarAuth0({ acao: 'registrar', url, auth0, log, fetchFn })
    }
    return { url }
  }

  const sha = exigir(env, 'DEPLOY_SHA')
  if (operacao === 'uat')
    return deployDeUat({ adapter, config, sha, exec, github, log, env, fetchFn, esteira })

  const pr = operacao === 'prod' ? undefined : numeroDoPr(env)
  const ctx = { config, pr, sha, exec, github, log, env, fetchFn, esteira }
  if (operacao === 'preview') await adapter.deployPreview(ctx)
  else if (operacao === 'prod') await adapter.deployProd(ctx)
  else {
    await adapter.encerrarPreview(ctx)
    if (config.host === 'heroku') await removerUrlDoReviewApp({ config, pr, env, log, fetchFn })
  }
  return {}
}

/** Deploy de UAT fixo do SHA (push na integração) e registro do Deployment `uat`. */
async function deployDeUat({ adapter, ...ctx }) {
  if (!ctx.esteira) {
    throw new Error(
      'deploy: a operação uat exige o bloco esteira em hooks/protect-main/config.json'
    )
  }
  if (!ctx.github) {
    throw new Error(
      'deploy: GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios para o deploy de UAT'
    )
  }
  const { url, payload } = await adapter.deployUat(ctx)
  await registrar(ctx.github, { ambiente: 'uat', sha: ctx.sha, url, payload })
  ctx.log(`deploy de UAT de ${ctx.sha.slice(0, 7)} registrado em ${url}`)
  return { url }
}

async function removerUrlDoReviewApp({ config, pr, env, log, fetchFn }) {
  const auth0 = lerConfigAuth0(env)
  if (!auth0) return log('Auth0 não configurado (AUTH0_*): pulando a remoção da URL')
  const token = env.HEROKU_API_KEY
  if (!token) throw new Error('deploy: variável HEROKU_API_KEY é obrigatória para o Heroku')
  const url = await urlDoReviewApp({ pr, pipelineId: config.heroku.pipelineId, token, fetchFn })
  if (!url) return log(`sem review app para o PR #${pr}: nada a remover no Auth0`)
  await sincronizarAuth0({ acao: 'remover', url, auth0, log, fetchFn })
}

/**
 * `execFile` sem shell. `opts.env` (ex.: `VERCEL_TOKEN` do rollback) soma-se ao env do processo
 * só no filho. Falha → Error com `code` = exit code (o `git merge-base --is-ancestor` usa 1).
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ env?: Record<string, string> }} [opts]
 * @returns {Promise<string>}
 */
export const execReal = (cmd, args, { env } = {}) =>
  new Promise((resolve, reject) => {
    const opcoes = { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } }
    execFile(cmd, args, opcoes, (error, stdout, stderr) => {
      if (!error) return resolve(String(stdout))
      const detalhe = String(stderr).trim() || error.message
      reject(Object.assign(new Error(`deploy: '${cmd}' falhou: ${detalhe}`), { code: error.code }))
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
