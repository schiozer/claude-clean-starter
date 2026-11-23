#!/usr/bin/env node
// Promoção da esteira (spec esteira-build-once-promote §3.1-7): leva para Prod **o mesmo pacote**
// que está no UAT, registra o Deployment `production`, faz o smoke test, avança a `main` por
// fast-forward (push com o token da App `esteira-promover`, sem forçar) e corta a Release.
// Disparado só pelo humano (`promover.yml`, `[R3]` para o agente). Sem o bloco `esteira`: no-op.
//
// A Guarda da main (scripts/main-guard.mjs) só aceita o FF da App se já existir um Deployment
// `production` com `payload.sha === after` e status success: por isso o registro vem ANTES do FF
// nos dois fluxos, e vira `failure` se a promoção não se completar.

import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as esperar } from 'node:timers/promises'
import { latestCheckRun, makeGithubClient } from '../github-api.mjs'
import { makeReleaseApi, runReleasePromocao } from '../release.mjs'
import { lerDeployConfig } from '../deploy/config.mjs'
import { adaptador, execReal } from '../deploy/index.mjs'
import { marcar, registrar, ultimoOk } from '../deploy/githubDeployments.mjs'
import { prodIntocada } from '../deploy/prodIntocada.mjs'
import { lerEsteira } from './config.mjs'

/** Nome exato do check-run da regressão contra o UAT fixo (o deploy.yml publica no SHA). */
export const REGRESSAO_UAT = 'Regressão (UAT)'

/**
 * `external_id` do check publicado pelo `deploy.yml` (job `publicar-regressao-uat`). A Regressão
 * do PR tem o mesmo nome e pode cair no mesmo SHA (head do PR = ponta da integração): só o check
 * com esta marca é o veredito do UAT.
 */
export const MARCA_REGRESSAO_UAT = 'esteira-uat'

const curto = (sha) => String(sha).slice(0, 7)
const mensagem = (error) => (error instanceof Error ? error.message : String(error))

/**
 * @typedef {import('./config.mjs').Esteira} Esteira
 * @typedef {{ call: (method: string, path: string, body?: unknown) => Promise<any> }} GithubApi
 * @typedef {{
 *   shaDe(branch: string): Promise<string>,
 *   ehAncestral(a: string, b: string): Promise<boolean>,
 *   ff(sha: string): Promise<void>,
 *   ultimaTag(ref: string): Promise<string | null>,
 * }} Git
 */

async function exigirRegressaoVerde(github, sha) {
  const nome = encodeURIComponent(REGRESSAO_UAT)
  const dados = await github.call(
    'GET',
    `/commits/${sha}/check-runs?check_name=${nome}&filter=latest&per_page=100`
  )
  const doUat = (dados?.check_runs ?? []).filter((r) => r.external_id === MARCA_REGRESSAO_UAT)
  const run = latestCheckRun(doUat, REGRESSAO_UAT)
  if (run?.status !== 'completed' || run?.conclusion !== 'success') {
    const estado = run ? `${run.status}/${run.conclusion ?? '-'}` : 'ausente'
    throw new Error(`promover: Regressão (UAT) não está verde para ${curto(sha)} (${estado})`)
  }
}

async function abrirIssueMainAFrente(github, { sha, motivo, esteira }) {
  await github.call('POST', '/issues', {
    title: `esteira: ${esteira.producao} à frente de Prod (${curto(sha)})`,
    labels: ['esteira'],
    body: [
      `A promoção de \`${sha}\` avançou a \`${esteira.producao}\` (fast-forward), mas Prod não`,
      `ficou com esse commit: ${motivo}.`,
      '',
      'Prod segue na versão anterior (rollback feito quando possível). A correção segue pela',
      `esteira de hotfix (\`${esteira.prefixoHotfix}*\` com base \`${esteira.producao}\`) — decisão`,
      'do humano. Ver o runbook `promover-prod.md`.',
    ].join('\n'),
  })
}

/**
 * Volta Prod para a release anterior depois de uma falha (`motivo`). `payload` = o que o
 * `promoverProd` devolveu, se devolveu (ex.: `revisaoAnterior` do Cloud Run); pode ser `{}`.
 * Se o `erro` diz que Prod não foi alterada (`prodAlterada: false`, ver `deploy/prodIntocada.mjs`),
 * não reverte: rebaixar uma Prod saudável é pior que o erro.
 * @returns {Promise<string>} o motivo, acrescido da falha do rollback se ele também falhar.
 */
async function reverterProd({ adapter, adapterCtx, payload, motivo, erro }) {
  if (prodIntocada(erro)) return `${motivo} (Prod não foi alterada: sem rollback)`
  try {
    await adapter.rollbackProd({ ...adapterCtx, payload: payload ?? {} })
    adapterCtx.log(`rollback de Prod feito: ${motivo}`)
    return motivo
  } catch (falhaDoRollback) {
    return (
      `${motivo}; rollback também falhou: ${mensagem(falhaDoRollback)} — ` +
      'verifique Prod manualmente'
    )
  }
}

/**
 * Heroku/Cloud Run: promoverProd → registrar production → smoke → ancestralidade de novo → FF.
 * Qualquer falha a partir do promoverProd (inclusive dele: no Heroku ele pode falhar depois de
 * Prod já ter mudado) faz rollback e marca o Deployment `failure`, sem FF — salvo falha do
 * promoverProd antes de mudar Prod (`prodAlterada: false`): aí só o erro.
 */
async function promoverAntesDoFF({ adapter, github, git, smoke, esteira, adapterCtx, urlProd }) {
  const { sha } = adapterCtx
  let payload
  let id
  try {
    ;({ payload } = await adapter.promoverProd(adapterCtx))
    id = await registrar(github, { ambiente: 'production', sha, url: urlProd, payload })
    if (!(await smoke(urlProd))) throw new Error(`smoke test em Prod falhou (${urlProd})`)
    const mainAgora = await git.shaDe(esteira.producao)
    if (!(await git.ehAncestral(mainAgora, sha))) {
      throw new Error(`a ${esteira.producao} mudou durante a promoção (hotfix?)`)
    }
    try {
      await git.ff(sha)
    } catch (error) {
      throw new Error(`fast-forward da ${esteira.producao} recusado: ${mensagem(error)}`)
    }
  } catch (error) {
    const motivo = await reverterProd({
      adapter,
      adapterCtx,
      payload,
      motivo: mensagem(error),
      erro: error,
    })
    if (id !== undefined) await marcar(github, id, 'failure', urlProd)
    throw new Error(`promover: ${motivo}`)
  }
}

/**
 * Vercel (`promoveAposFF`): registrar production → FF (dispara o build de Production do mesmo
 * SHA) → espera o deploy → smoke. Depois do FF, qualquer falha (deploy ou smoke) = rollback,
 * `failure` e issue "main à frente de Prod".
 * @returns {Promise<void>}
 */
async function promoverAposFF({ adapter, github, git, smoke, esteira, adapterCtx, urlProd }) {
  const { sha } = adapterCtx
  const id = await registrar(github, { ambiente: 'production', sha, url: urlProd ?? '' })
  try {
    await git.ff(sha)
  } catch (error) {
    await marcar(github, id, 'failure')
    throw new Error(`promover: fast-forward da ${esteira.producao} recusado: ${mensagem(error)}`)
  }

  let payload
  let url = urlProd
  try {
    ;({ payload } = await adapter.promoverProd(adapterCtx))
    url = urlProd ?? payload?.url
    await marcar(github, id, 'success', url)
    if (!url) throw new Error('deploy de Production sem URL para o smoke test (defina PROD_URL)')
    if (!(await smoke(url))) throw new Error(`smoke test em Prod falhou (${url})`)
  } catch (error) {
    const motivo = await reverterProd({
      adapter,
      adapterCtx,
      payload,
      motivo: mensagem(error),
      erro: error,
    })
    await marcar(github, id, 'failure', url)
    await abrirIssueMainAFrente(github, { sha, motivo, esteira })
    throw new Error(`promover: ${motivo}`)
  }
}

/**
 * @param {{
 *   esteira: Esteira,
 *   adapter: { nome?: string, promoveAposFF: boolean, promoverProd: Function, rollbackProd: Function },
 *   github: GithubApi,
 *   git: Git,
 *   smoke: (url: string) => Promise<boolean>,
 *   release: (range: { de: string, ate: string }) => Promise<{ tag: string }>,
 *   actor: string,
 *   log: (msg: string) => void,
 *   ctx?: Record<string, unknown>,
 *   urlProd?: string,
 * }} opcoes `ctx` = base do ctx do adaptador (config, exec, env, fetchFn); `urlProd` = alvo do smoke.
 * @returns {Promise<{ promovido: boolean, sha?: string, tag?: string }>}
 */
export async function promover({
  esteira,
  adapter,
  github,
  git,
  smoke,
  release,
  actor,
  log,
  ctx = {},
  urlProd,
}) {
  if (!esteira.promotores.includes(actor)) {
    throw new Error(`promover: ${actor || '(sem actor)'} não está em esteira.promotores`)
  }
  if (!adapter.promoveAposFF && !urlProd) {
    throw new Error(
      `promover: PROD_URL (URL de Prod para o smoke test) é obrigatória no host ${adapter.nome ?? ''}`.trim()
    )
  }

  const uat = await ultimoOk(github, 'uat')
  if (!uat) throw new Error('promover: sem deploy de UAT bem-sucedido (Deployment `uat`)')
  const { sha } = uat
  await exigirRegressaoVerde(github, sha)

  const mainAntes = await git.shaDe(esteira.producao)
  if (mainAntes === sha) {
    log(`a ${esteira.producao} já está em ${curto(sha)}: nada a promover`)
    return { promovido: false, sha }
  }
  if (!(await git.ehAncestral(mainAntes, sha))) {
    throw new Error(
      `promover: há back-promotion pendente: mergeie o PR ${esteira.producao} → ` +
        `${esteira.integracao} e aguarde o novo deploy de UAT`
    )
  }
  const de = (await git.ultimaTag(mainAntes)) ?? mainAntes

  log(`promovendo ${curto(sha)} (UAT) para Prod`)
  const passos = { adapter, github, git, smoke, esteira, urlProd }
  const adapterCtx = { ...ctx, sha, esteira, github, log }
  if (adapter.promoveAposFF) await promoverAposFF({ ...passos, adapterCtx })
  else await promoverAntesDoFF({ ...passos, adapterCtx })

  log(`${esteira.producao} avançou para ${curto(sha)}`)
  const { tag } = await release({ de, ate: sha })
  log(`release ${tag} criada`)
  return { promovido: true, sha, tag }
}

/**
 * Git do runner (checkout com `fetch-depth: 0` e o token da App). `rodar(cmd, args)` lança Error
 * com `code` = exit code. O FF é um push simples do SHA: o servidor recusa se não for FF.
 * @param {{ rodar: (cmd: string, args: string[]) => Promise<string>, producao: string }} opcoes
 * @returns {Git}
 */
export function makeGit({ rodar, producao }) {
  return {
    async shaDe(branch) {
      await rodar('git', ['fetch', 'origin', branch])
      return String(await rodar('git', ['rev-parse', `origin/${branch}`])).trim()
    },
    async ehAncestral(a, b) {
      try {
        await rodar('git', ['merge-base', '--is-ancestor', a, b])
        return true
      } catch (error) {
        if (error?.code === 1) return false
        throw error
      }
    },
    async ff(sha) {
      await rodar('git', ['push', 'origin', `${sha}:refs/heads/${producao}`])
    },
    async ultimaTag(ref) {
      try {
        const tag = await rodar('git', [
          'describe',
          '--tags',
          '--abbrev=0',
          '--match',
          'v[0-9]*.[0-9]*.[0-9]*',
          ref,
        ])
        return String(tag).trim() || null
      } catch (error) {
        if (error?.code === 128) return null // sem tag alcançável
        throw error
      }
    },
  }
}

/**
 * Smoke test HTTP: GET na URL até 2xx (redirects seguidos), com novas tentativas.
 * @param {{ fetchFn?: typeof fetch, sleep?: (ms: number) => Promise<unknown>,
 *   tentativas?: number, intervaloMs?: number }} [opcoes]
 */
export function smokeHttp({
  fetchFn = globalThis.fetch,
  sleep = (ms) => esperar(ms),
  tentativas = 5,
  intervaloMs = 10000,
} = {}) {
  return async (url) => {
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      try {
        const resposta = await fetchFn(url, { method: 'GET', redirect: 'follow' })
        if (resposta.ok) return true
      } catch {
        // erro de rede: conta como falha desta tentativa
      }
      if (tentativa < tentativas) await sleep(intervaloMs)
    }
    return false
  }
}

const logPadrao = (msg) => process.stdout.write(`promover: ${msg}\n`)

/**
 * Monta as dependências reais a partir do repositório e do env do runner.
 * @param {{ raiz?: string, env?: NodeJS.ProcessEnv, log?: (msg: string) => void,
 *   fetchFn?: typeof fetch, rodar?: (cmd: string, args: string[], opts?: object) => Promise<string> }} [opcoes]
 */
export async function executarPromocao({
  raiz = process.cwd(),
  env = process.env,
  log = logPadrao,
  fetchFn = globalThis.fetch,
  rodar = execReal,
} = {}) {
  const esteira = lerEsteira(raiz)
  if (!esteira) {
    log(
      'esteira desligada (sem o bloco esteira em hooks/protect-main/config.json): nada a promover'
    )
    return { promovido: false }
  }
  const config = lerDeployConfig(raiz, { esteira })
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL } = env
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    throw new Error('promover: GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios')
  }
  const conexao = {
    token: GITHUB_TOKEN,
    repository: GITHUB_REPOSITORY,
    apiUrl: GITHUB_API_URL || undefined,
    fetchFn,
  }
  const github = makeGithubClient({ ...conexao, userAgent: 'esteira-promover' })
  const releaseApi = makeReleaseApi(conexao)
  const release = (range) => {
    const { version } = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8'))
    return runReleasePromocao(range, releaseApi, { esteira, packageVersion: version })
  }
  return promover({
    esteira,
    adapter: adaptador(config.host),
    github,
    git: makeGit({ rodar, producao: esteira.producao }),
    smoke: smokeHttp({ fetchFn }),
    release,
    // re-run feito por outra pessoa: vale quem disparou esta execução.
    actor: env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR || '',
    log,
    ctx: { config, exec: rodar, env, fetchFn },
    urlProd: env.PROD_URL || undefined,
  })
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const resultado = await executarPromocao()
    if (!resultado.promovido && !resultado.sha) {
      process.stdout.write('::warning::Esteira desligada: nada a promover.\n')
    }
  } catch (error) {
    process.stderr.write(`${mensagem(error)}\n`)
    process.exit(1)
  }
}
