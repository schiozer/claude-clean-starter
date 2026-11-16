// Adaptador Cloud Run: o PR vira uma revisão sem tráfego com a tag `pr-<n>` no serviço do UAT;
// a Prod reconstrói a partir da `main` e move o tráfego para a última revisão.
// A credencial vem do workflow (Workload Identity Federation); aqui nunca há chave nem segredo.
// As variáveis do app são configuradas pelo humano no serviço: o CI não passa `--set-env-vars`.

const RUNBOOK = 'docs/runbooks/host-cloudrun.md'

/** Caminho da imagem no Artifact Registry do ambiente. */
export const imagem = (cfg, ambiente, tag) => {
  const amb = cfg[ambiente]
  return `${cfg.region}-docker.pkg.dev/${amb.project}/${cfg.repository}/${amb.service}:${tag}`
}

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

async function urlDaTag(exec, cfg, tag) {
  const json = await exec('gcloud', [
    'run',
    'services',
    'describe',
    cfg.uat.service,
    ...local(cfg, 'uat'),
    '--format=json',
  ])
  const trafego = JSON.parse(json)?.status?.traffic ?? []
  const url = trafego.find((t) => t.tag === tag)?.url
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
  try {
    await exec('gcloud', [
      'run',
      'services',
      'update-traffic',
      cfg.uat.service,
      '--remove-tags',
      tag,
      ...local(cfg, 'uat'),
    ])
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    if (!/not found|does not exist|não existe/i.test(mensagem)) throw error
    log?.(`tag ${tag} já não existe no serviço ${cfg.uat.service}; nada a encerrar`)
  }
}

export default {
  nome: 'cloudrun',
  ambienteDePreview: (e) => e === 'Preview',
  deployPreview,
  deployProd,
  encerrarPreview,
}
