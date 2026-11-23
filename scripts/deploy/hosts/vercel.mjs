// Adaptador Vercel: o deploy é feito pela integração Git da Vercel; aqui tudo é no-op.
// O preview é achado na API de deployments do GitHub (ambiente `Preview*`).
// Com a esteira (spec esteira-build-once-promote §5.6, V1), a branch de integração é o UAT e o FF da
// `main` dispara o build de Production da própria Vercel **do mesmo SHA** (`promoveAposFF: true`):
// garantia de mesmo commit, não de mesmo pacote. O adaptador só espera esses deploys pela API de
// Deployments do GitHub; o único comando é o `vercel rollback`, com `VERCEL_TOKEN` só no env do
// processo filho (o `exec` injetado usa `execFile`, sem shell).

import { waitPreview } from '../aguardar.mjs'

const noop = async () => {}

/** Nome do ambiente que a integração Vercel-GitHub dá ao deploy de Production. */
const PRODUCTION = 'Production'
/** Custom Environment de UAT (plano Pro); no Hobby o UAT é o Preview da branch de integração. */
const UAT = 'uat'

const INTEGRACAO_PADRAO = 'develop'

const exigirGithub = (github) => {
  if (!github) throw new Error('deploy: GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios')
  return github
}

/** Opções de polling do ctx (`now/sleep/timeoutMs/intervalMs`), sem sobrescrever os padrões. */
const espera = (ctx) =>
  Object.fromEntries(
    ['now', 'sleep', 'timeoutMs', 'intervalMs']
      .filter((chave) => ctx[chave] !== undefined)
      .map((chave) => [chave, ctx[chave]])
  )

/**
 * Deploy de UAT do SHA: o Custom Environment `uat` ou o `Preview*` da branch de integração
 * (`ctx.esteira.integracao`, padrão `develop`).
 * @param {{ config: any, sha: string, github: any, esteira?: { integracao?: string } }} ctx
 * @returns {Promise<{ url: string, payload: { deploymentUrl: string } }>}
 */
async function deployUat(ctx) {
  const integracao = ctx.esteira?.integracao ?? INTEGRACAO_PADRAO
  const { url } = await waitPreview({
    api: exigirGithub(ctx.github),
    sha: ctx.sha,
    rotulo: 'UAT',
    ambienteDePreview: (environment, deployment) =>
      environment === UAT || (environment.startsWith('Preview') && deployment.ref === integracao),
    ...espera(ctx),
  })
  return { url, payload: { deploymentUrl: url } }
}

/** URL estável do UAT: o alias da branch de integração (`config.vercel.uatAlias`). */
async function urlUat(ctx) {
  const alias = ctx.config.vercel.uatAlias
  return /^https?:\/\//.test(alias) ? alias : `https://${alias}`
}

/**
 * Sem build: o FF da `main` já disparou o deploy de Production da Vercel. Espera o Deployment
 * `Production` do SHA chegar a `success` (CT-ESTEIRA-012).
 * @returns {Promise<{ payload: { deploymentUrl: string } }>}
 */
async function promoverProd(ctx) {
  const { url } = await waitPreview({
    api: exigirGithub(ctx.github),
    sha: ctx.sha,
    rotulo: PRODUCTION,
    ambienteDePreview: (environment) => environment === PRODUCTION,
    ...espera(ctx),
  })
  ctx.log?.(`deploy de Production de ${String(ctx.sha).slice(0, 7)} pronto em ${url}`)
  return { payload: { deploymentUrl: url } }
}

/**
 * Rollback instantâneo de Prod para o deploy anterior. `VERCEL_TOKEN` vai só no env do processo
 * filho (3º argumento do `exec`, somado ao env do runner): nunca em argv nem em log.
 */
async function rollbackProd(ctx) {
  const token = ctx.env?.VERCEL_TOKEN
  if (!token) {
    throw new Error('deploy: variável VERCEL_TOKEN é obrigatória para o rollback na Vercel')
  }
  const { team } = ctx.config.vercel
  await ctx.exec('vercel', ['rollback', '--yes', '--scope', team], { env: { VERCEL_TOKEN: token } })
  ctx.log?.(`rollback de Production na Vercel (${team}) concluído`)
}

export default {
  nome: 'vercel',
  promoveAposFF: true,
  ambienteDePreview: (environment) => environment.startsWith('Preview'),
  deployPreview: noop,
  deployProd: noop,
  encerrarPreview: noop,
  deployUat,
  urlUat,
  promoverProd,
  rollbackProd,
}
