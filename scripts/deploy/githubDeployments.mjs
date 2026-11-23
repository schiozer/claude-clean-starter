// GitHub Deployments da esteira (spec esteira-build-once-promote §5.6): registra o que está em
// `uat`/`production` e acha o último deploy bom de um ambiente (base do rollback e da promoção).
// `payload.sha` é o SHA; o resto do payload é do host (`slug` | `digest` | `deploymentId`).

/**
 * Cliente fino da REST do GitHub (o `makeGithubClient` de `scripts/github-api.mjs`): `path`
 * relativo a `/repos/{repository}`; devolve o JSON parseado e lança Error com `status` em HTTP != 2xx.
 * @typedef {{ call: (method: string, path: string, body?: unknown) => Promise<any> }} GithubApi
 * @typedef {'uat' | 'production'} Ambiente
 */

const maisNovoPrimeiro = (a, b) =>
  String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id

const lerPayload = (payload) => {
  if (typeof payload !== 'string') return payload ?? {}
  try {
    return JSON.parse(payload)
  } catch {
    return {}
  }
}

/**
 * Posta um status no deployment `id`.
 * @param {GithubApi} github
 * @param {number} id
 * @param {string} state `success` | `failure` | `error` | `in_progress` | `inactive` | ...
 * @param {string} [url] `environment_url`
 */
export async function marcar(github, id, state, url) {
  await github.call('POST', `/deployments/${id}/statuses`, {
    state,
    ...(url ? { environment_url: url } : {}),
  })
}

/**
 * Cria o Deployment do `sha` no `ambiente` e o marca `success` com a `url`.
 * @param {GithubApi} github
 * @param {{ sha: string, ambiente: Ambiente, url: string, payload?: object }} deploy
 * @returns {Promise<number>} id do deployment
 */
export async function registrar(github, { sha, ambiente, url, payload = {} }) {
  const deployment = await github.call('POST', '/deployments', {
    ref: sha,
    environment: ambiente,
    payload: { sha, ...payload },
    auto_merge: false,
    required_contexts: [],
  })
  await marcar(github, deployment.id, 'success', url)
  return deployment.id
}

/**
 * Deploy mais novo do `ambiente` cujo status mais recente é `success` (pula `failure`, `error`,
 * `inactive` e sem status). `sha` vem de `payload.sha` (fallback: o `sha` do deployment).
 * @param {GithubApi} github
 * @param {Ambiente} ambiente
 * @returns {Promise<{ sha: string, payload: object, url: string } | null>}
 */
export async function ultimoOk(github, ambiente) {
  const deployments = await github.call(
    'GET',
    `/deployments?environment=${encodeURIComponent(ambiente)}&per_page=100`
  )
  for (const deployment of [...(deployments ?? [])].sort(maisNovoPrimeiro)) {
    // a API devolve os status do mais novo para o mais antigo.
    const statuses = await github.call('GET', `/deployments/${deployment.id}/statuses?per_page=1`)
    const atual = statuses?.[0]
    if (atual?.state !== 'success') continue
    const payload = lerPayload(deployment.payload)
    return {
      sha: payload.sha ?? deployment.sha,
      payload,
      url: atual.environment_url || atual.target_url || '',
    }
  }
  return null
}
