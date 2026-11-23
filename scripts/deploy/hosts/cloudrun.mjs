// Adaptador Cloud Run: o PR vira uma revisão sem tráfego com a tag `pr-<n>` no serviço do UAT;
// a Prod reconstrói a partir da `main` e move o tráfego para a última revisão.
// A credencial vem do workflow (Workload Identity Federation); aqui nunca há chave nem segredo.
// As variáveis do app são configuradas pelo humano no serviço: o CI não passa `--set-env-vars`.
// Com a esteira (spec esteira-build-once-promote §5.6), o serviço de UAT recebe a imagem do SHA
// (100% do tráfego) e Prod recebe **a mesma imagem pelo digest** (`<repo-uat>@sha256:…`), sem
// build. Pré-requisito: a service account de Prod com `roles/artifactregistry.reader` no
// repositório do UAT (runbook de adoção da esteira).

import { ultimoOk } from '../githubDeployments.mjs'
import { antesDeMudarProd } from '../prodIntocada.mjs'

const RUNBOOK = 'docs/runbooks/host-cloudrun.md'

/** Caminho da imagem no Artifact Registry do ambiente. */
export const imagem = (cfg, ambiente, tag) => `${repositorio(cfg, ambiente)}:${tag}`

/** Caminho da imagem sem tag nem digest. */
const repositorio = (cfg, ambiente) => {
  const amb = cfg[ambiente]
  return `${cfg.region}-docker.pkg.dev/${amb.project}/${cfg.repository}/${amb.service}`
}

const DIGEST = /^sha256:[0-9a-f]{64}$/

const local = (cfg, ambiente) => ['--project', cfg[ambiente].project, '--region', cfg.region]

const sha7 = (sha) => String(sha).slice(0, 7)

const tagDoPr = (pr) => {
  if (!Number.isInteger(pr) || pr <= 0) throw new Error('deploy: cloudrun exige PR_NUMBER válido')
  return `pr-${pr}`
}

async function buildEPush(exec, img) {
  await exec('docker', ['build', '-t', img, '.'])
  await exec('docker', ['push', img])
}

async function exigirServico(exec, cfg) {
  const { service, project } = cfg.uat
  try {
    await exec('gcloud', [
      'run',
      'services',
      'describe',
      service,
      ...local(cfg, 'uat'),
      '--format=value(metadata.name)',
    ])
  } catch {
    throw new Error(`Serviço ${service} não existe em ${project}: rode o Bootstrap de ${RUNBOOK}`)
  }
}

async function trafegoDoServico(exec, cfg) {
  const json = await exec('gcloud', [
    'run',
    'services',
    'describe',
    cfg.uat.service,
    ...local(cfg, 'uat'),
    '--format=json',
  ])
  return JSON.parse(json)?.status?.traffic ?? []
}

async function urlDaTag(exec, cfg, tag) {
  const url = (await trafegoDoServico(exec, cfg)).find((t) => t.tag === tag)?.url
  if (!url) throw new Error(`deploy: tag ${tag} sem URL no serviço ${cfg.uat.service}`)
  return url
}

async function publicarDeployment(github, sha, url) {
  if (!github) throw new Error('deploy: GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios')
  const deployment = await github.call('POST', '/deployments', {
    ref: sha,
    environment: 'Preview',
    auto_merge: false,
    required_contexts: [],
    transient_environment: true,
  })
  await github.call('POST', `/deployments/${deployment.id}/statuses`, {
    state: 'success',
    environment_url: url,
  })
}

async function deployPreview({ config, pr, sha, exec, github, log }) {
  const cfg = config.cloudrun
  const tag = tagDoPr(pr)
  await exigirServico(exec, cfg)
  const img = imagem(cfg, 'uat', `${tag}-${sha7(sha)}`)
  await buildEPush(exec, img)
  await exec('gcloud', [
    'run',
    'deploy',
    cfg.uat.service,
    '--image',
    img,
    ...local(cfg, 'uat'),
    '--tag',
    tag,
    '--no-traffic',
  ])
  const url = await urlDaTag(exec, cfg, tag)
  await publicarDeployment(github, sha, url)
  log?.(`preview ${tag} publicado em ${url}`)
}

async function deployProd({ config, sha, exec, log }) {
  const cfg = config.cloudrun
  const img = imagem(cfg, 'prod', `main-${sha7(sha)}`)
  await buildEPush(exec, img)
  await exec('gcloud', ['run', 'deploy', cfg.prod.service, '--image', img, ...local(cfg, 'prod')])
  await exec('gcloud', [
    'run',
    'services',
    'update-traffic',
    cfg.prod.service,
    '--to-latest',
    ...local(cfg, 'prod'),
  ])
  log?.(`prod publicada com ${img}`)
}

async function encerrarPreview({ config, pr, exec, log }) {
  const cfg = config.cloudrun
  const tag = tagDoPr(pr)
  const trafego = await trafegoDoServico(exec, cfg)
  if (!trafego.some((t) => t.tag === tag)) {
    log?.(`tag ${tag} já não existe no serviço ${cfg.uat.service}; nada a encerrar`)
    return
  }
  await exec('gcloud', [
    'run',
    'services',
    'update-traffic',
    cfg.uat.service,
    '--remove-tags',
    tag,
    ...local(cfg, 'uat'),
  ])
}

// ---------------------------------------------------------------- esteira

const descreverServico = async (exec, cfg, ambiente, formato) =>
  exec('gcloud', [
    'run',
    'services',
    'describe',
    cfg[ambiente].service,
    ...local(cfg, ambiente),
    `--format=${formato}`,
  ])

const moverTrafegoParaUltima = (exec, cfg, ambiente) =>
  exec('gcloud', [
    'run',
    'services',
    'update-traffic',
    cfg[ambiente].service,
    '--to-latest',
    ...local(cfg, ambiente),
  ])

/** Revisão que serve 100% do tráfego (`latestRevision` resolve para a última pronta), ou null. */
async function revisaoServindo(exec, cfg, ambiente) {
  const status = JSON.parse(await descreverServico(exec, cfg, ambiente, 'json'))?.status ?? {}
  const cheia = (status.traffic ?? []).find((t) => t.percent === 100)
  if (!cheia) return null
  return (cheia.latestRevision ? status.latestReadyRevisionName : cheia.revisionName) || null
}

async function urlUat({ config, exec }) {
  const url = String(await descreverServico(exec, config.cloudrun, 'uat', 'value(status.url)'))
  if (!url.trim()) throw new Error(`deploy: serviço ${config.cloudrun.uat.service} sem URL`)
  return url.trim()
}

/**
 * Builda `develop-<sha7>`, publica, lê o digest e faz deploy **por digest** no serviço de UAT com
 * 100% do tráfego. O payload (`digest`, `imagem`) vai para o GitHub Deployment `uat` (quem registra
 * é o promover) e é a fonte do `promoverProd`.
 * @returns {Promise<{ url: string, payload: { digest: string, imagem: string } }>}
 */
async function deployUat(ctx) {
  const { config, sha, exec, log } = ctx
  const cfg = config.cloudrun
  await exigirServico(exec, cfg)
  const img = imagem(cfg, 'uat', `develop-${sha7(sha)}`)
  await buildEPush(exec, img)
  const digest = String(
    await exec('gcloud', [
      'artifacts',
      'docker',
      'images',
      'describe',
      img,
      '--format=value(image_summary.digest)',
    ])
  ).trim()
  if (!DIGEST.test(digest)) throw new Error(`deploy: digest inválido para ${img}: '${digest}'`)
  await exec('gcloud', [
    'run',
    'deploy',
    cfg.uat.service,
    '--image',
    `${repositorio(cfg, 'uat')}@${digest}`,
    ...local(cfg, 'uat'),
  ])
  await moverTrafegoParaUltima(exec, cfg, 'uat')
  const url = await urlUat(ctx)
  log?.(`uat publicado com ${img} (${digest}) em ${url}`)
  return { url, payload: { digest, imagem: img } }
}

/**
 * CT-ESTEIRA-011: deploy no serviço de Prod da imagem do UAT **pelo digest** do último deploy de
 * UAT bom (`ultimoOk(github, 'uat')`), que precisa ser do SHA pedido. Sem build. Antes do deploy,
 * anota a revisão que serve 100% em Prod (`payload.revisaoAnterior`) para o `rollbackProd`.
 * @returns {Promise<{ payload: { digest: string, imagem: string, revisaoAnterior?: string } }>}
 */
async function promoverProd({ config, sha, exec, github, log }) {
  const cfg = config.cloudrun
  // Até o `gcloud run deploy` nada mudou em Prod: falha aqui não pede rollback.
  const { digest, img, revisaoAnterior } = await antesDeMudarProd(async () => {
    const uat = await ultimoOk(github, 'uat')
    if (!uat || uat.sha !== sha) throw new Error(`sem deploy de UAT para ${sha7(sha)}`)
    const digest = uat.payload?.digest
    if (typeof digest !== 'string' || !DIGEST.test(digest)) {
      throw new Error(`deploy: deploy de UAT de ${sha7(sha)} sem digest válido no payload`)
    }
    const img = `${repositorio(cfg, 'uat')}@${digest}`
    return { digest, img, revisaoAnterior: await revisaoServindo(exec, cfg, 'prod') }
  })
  await exec('gcloud', ['run', 'deploy', cfg.prod.service, '--image', img, ...local(cfg, 'prod')])
  await moverTrafegoParaUltima(exec, cfg, 'prod')
  log?.(`prod promovida com ${img}${revisaoAnterior ? ` (anterior: ${revisaoAnterior})` : ''}`)
  return { payload: { digest, imagem: img, ...(revisaoAnterior ? { revisaoAnterior } : {}) } }
}

const pronta = (rev) =>
  (rev?.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True')

/**
 * Sem anotação: a revisão pronta mais nova criada antes da que serve 100% hoje (determinístico:
 * depende só do estado do serviço).
 */
async function revisaoAnteriorDeterministica(exec, cfg) {
  const atual = await revisaoServindo(exec, cfg, 'prod')
  const revisoes = JSON.parse(
    await exec('gcloud', [
      'run',
      'revisions',
      'list',
      '--service',
      cfg.prod.service,
      ...local(cfg, 'prod'),
      '--format=json',
    ])
  )
  const criada = (rev) => String(rev?.metadata?.creationTimestamp ?? '')
  const daAtual = (revisoes ?? []).find((r) => r?.metadata?.name === atual)
  return (
    (revisoes ?? [])
      .filter((r) => daAtual && pronta(r) && r.metadata.name !== atual)
      .filter((r) => criada(r).localeCompare(criada(daAtual)) < 0)
      .sort((a, b) => criada(b).localeCompare(criada(a)))[0]?.metadata?.name ?? null
  )
}

/**
 * Volta 100% do tráfego de Prod para a revisão anterior: a anotada pelo `promoverProd`
 * (`ctx.payload.revisaoAnterior`, ex.: lida do Deployment `production`) ou, sem ela, a revisão
 * pronta mais nova anterior à que serve 100%.
 */
async function rollbackProd({ config, exec, log, payload }) {
  const cfg = config.cloudrun
  const revisao = payload?.revisaoAnterior ?? (await revisaoAnteriorDeterministica(exec, cfg))
  if (!revisao) throw new Error(`deploy: ${cfg.prod.service} sem revisão anterior para o rollback`)
  await exec('gcloud', [
    'run',
    'services',
    'update-traffic',
    cfg.prod.service,
    `--to-revisions=${revisao}=100`,
    ...local(cfg, 'prod'),
  ])
  log?.(`rollback do ${cfg.prod.service} para a revisão ${revisao}`)
}

export default {
  nome: 'cloudrun',
  promoveAposFF: false,
  ambienteDePreview: (e) => e === 'Preview',
  deployPreview,
  deployProd,
  encerrarPreview,
  deployUat,
  urlUat,
  promoverProd,
  rollbackProd,
}
