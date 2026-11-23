// Adaptador Vercel: o deploy é feito pela integração Git da Vercel; aqui tudo é no-op.
// O preview é achado na API de deployments do GitHub (ambiente `Preview*`).
// Com a esteira (spec esteira-build-once-promote §5.6, V1), a branch de integração é o UAT e o FF da
// `main` dispara o build de Production da própria Vercel **do mesmo SHA** (`promoveAposFF: true`):
// garantia de mesmo commit, não de mesmo pacote. O adaptador só espera esses deploys pela API de
// Deployments do GitHub, casando o ambiente por prefixo (a integração nomeia `Preview – <projeto>`,
// `Production – <projeto>` quando o repo tem mais de um projeto) e o deployment pelo `sha` (o `ref`
// pode ser o SHA, não a branch). O único comando é o `vercel rollback`, com `VERCEL_TOKEN`,
// `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` só no env do processo filho (o `exec` injetado usa
// `execFile`, sem shell).

import { aguardarDeployment } from '../aguardar.mjs'

const noop = async () => {}

/** Prefixo do ambiente que a integração Vercel-GitHub dá ao deploy de Production. */
const PRODUCTION = 'Production'
/** Prefixo do Custom Environment de UAT (plano Pro). */
const UAT = 'uat'
/** Prefixo do Preview (no Hobby, o UAT é o Preview da branch de integração). */
const PREVIEW = 'Preview'

/** Variáveis do `vercel rollback` no CI (sem `.vercel/` linkado): só no env do processo filho. */
const VARIAVEIS_ROLLBACK = ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']

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
 * Espera o Deployment do GitHub do `ctx.sha` (conferido em `deployment.sha`) cujo ambiente começa
 * com um dos `prefixos`; devolve a URL e o payload do host (`deploymentId` + `url`).
 */
async function aguardar(ctx, rotulo, prefixos) {
  const { url, id } = await aguardarDeployment({
    api: exigirGithub(ctx.github),
    sha: ctx.sha,
    rotulo,
    ambienteDePreview: (environment, deployment) =>
      deployment.sha === ctx.sha && prefixos.some((p) => environment.startsWith(p)),
    ...espera(ctx),
  })
  return { url, payload: { deploymentId: id, url } }
}

/**
 * Deploy de UAT do SHA: o Custom Environment `uat*` (Pro) ou o `Preview*` (Hobby; as variáveis de
 * Preview ficam restritas à branch de integração, que é quem tem o SHA no UAT).
 * @returns {Promise<{ url: string, payload: { deploymentId: number, url: string } }>}
 */
const deployUat = (ctx) => aguardar(ctx, 'UAT', [UAT, PREVIEW])

/** URL estável do UAT: o alias da branch de integração (`config.vercel.uatAlias`). */
async function urlUat(ctx) {
  const alias = ctx.config.vercel.uatAlias
  return /^https?:\/\//.test(alias) ? alias : `https://${alias}`
}

/**
 * Sem build: o FF da `main` já disparou o deploy de Production da Vercel. Espera o Deployment
 * `Production*` do SHA chegar a `success` (CT-ESTEIRA-012).
 * @returns {Promise<{ payload: { deploymentId: number, url: string } }>}
 */
async function promoverProd(ctx) {
  const { url, payload } = await aguardar(ctx, PRODUCTION, [PRODUCTION])
  ctx.log?.(`deploy de Production de ${String(ctx.sha).slice(0, 7)} pronto em ${url}`)
  return { payload }
}

/**
 * Rollback instantâneo de Prod para o deploy anterior. No CI não há projeto linkado (`.vercel/` é
 * ignorado pelo git): o CLI acha o projeto por `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` e autentica
 * por `VERCEL_TOKEN`. As três vão só no env do processo filho (3º argumento do `exec`, somado ao
 * env do runner): nunca em argv nem em log. O runbook da esteira (Task 11) diz onde gravá-las.
 */
async function rollbackProd(ctx) {
  const env = {}
  for (const variavel of VARIAVEIS_ROLLBACK) {
    const valor = ctx.env?.[variavel]
    if (!valor) {
      throw new Error(`deploy: variável ${variavel} é obrigatória para o rollback na Vercel`)
    }
    env[variavel] = valor
  }
  const { team } = ctx.config.vercel
  await ctx.exec('vercel', ['rollback', '--yes', '--scope', team], { env })
  ctx.log?.(`rollback de Production na Vercel (${team}) concluído`)
}

export default {
  nome: 'vercel',
  promoveAposFF: true,
  ambienteDePreview: (environment) => environment.startsWith(PREVIEW),
  deployPreview: noop,
  deployProd: noop,
  encerrarPreview: noop,
  deployUat,
  urlUat,
  promoverProd,
  rollbackProd,
}
