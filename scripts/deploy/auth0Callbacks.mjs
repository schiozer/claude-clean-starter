// Registra/remove a URL do review app (Heroku) no client Auth0 de UAT, via Management API.
// O token e o client secret nunca entram em mensagens de erro nem em log: erros HTTP só levam
// status e caminho.

export const CALLBACK_PADRAO = '/api/auth/callback'

const VARIAVEIS = [
  'AUTH0_MGMT_DOMAIN',
  'AUTH0_MGMT_CLIENT_ID',
  'AUTH0_MGMT_CLIENT_SECRET',
  'AUTH0_WEB_CLIENT_ID',
]

/** null = nenhuma variável (pular); parcial → erro nomeando as que faltam. */
export function lerConfigAuth0(env) {
  const presentes = VARIAVEIS.filter((n) => env[n])
  if (presentes.length === 0) return null
  const faltando = VARIAVEIS.filter((n) => !env[n])
  if (faltando.length > 0) {
    throw new Error(`deploy: configuração do Auth0 incompleta, faltam: ${faltando.join(', ')}`)
  }
  return {
    dominio: env.AUTH0_MGMT_DOMAIN,
    mgmtClientId: env.AUTH0_MGMT_CLIENT_ID,
    mgmtClientSecret: env.AUTH0_MGMT_CLIENT_SECRET,
    clientId: env.AUTH0_WEB_CLIENT_ID,
    callbackPath: env.AUTH0_CALLBACK_PATH || CALLBACK_PADRAO,
  }
}

const erroHttp = (status, caminho) => new Error(`Auth0: HTTP ${status} em ${caminho}`)

const baseDe = (dominio) => `https://${dominio.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`

export function urlsDoPreview(url, callbackPath = CALLBACK_PADRAO) {
  const base = url.replace(/\/+$/, '')
  return { logout: base, callback: `${base}/${callbackPath.replace(/^\/+/, '')}` }
}

export async function obterToken({ dominio, clientId, clientSecret, fetchFn = globalThis.fetch }) {
  const caminho = '/oauth/token'
  const resposta = await fetchFn(`${baseDe(dominio)}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: `${baseDe(dominio)}/api/v2/`,
    }),
  })
  if (!resposta.ok) throw erroHttp(resposta.status, caminho)
  const { access_token: token } = await resposta.json()
  if (!token) throw new Error(`Auth0: resposta sem access_token em ${caminho}`)
  return token
}

async function atualizar({ dominio, clientId, token, fetchFn, mudar }) {
  const caminho = `/api/v2/clients/${encodeURIComponent(clientId)}`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const lida = await fetchFn(`${baseDe(dominio)}${caminho}`, { headers })
  if (!lida.ok) throw erroHttp(lida.status, caminho)
  const cliente = await lida.json()
  const callbacks = cliente.callbacks ?? []
  const logouts = cliente.allowed_logout_urls ?? []
  const novo = mudar(callbacks, logouts)
  if (!novo) return { alterado: false }
  const resposta = await fetchFn(`${baseDe(dominio)}${caminho}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ callbacks: novo.callbacks, allowed_logout_urls: novo.logouts }),
  })
  if (!resposta.ok) throw erroHttp(resposta.status, caminho)
  return { alterado: true }
}

/**
 * @typedef {{
 *   dominio: string,
 *   clientId: string,
 *   token: string,
 *   url: string,
 *   callbackPath?: string,
 *   fetchFn?: typeof fetch,
 * }} OpcoesUrl
 */

/** @param {OpcoesUrl} opcoes */
export function registrarUrl({
  dominio,
  clientId,
  token,
  url,
  callbackPath,
  fetchFn = globalThis.fetch,
}) {
  const { callback, logout } = urlsDoPreview(url, callbackPath)
  return atualizar({
    dominio,
    clientId,
    token,
    fetchFn,
    mudar: (callbacks, logouts) => {
      if (callbacks.includes(callback) && logouts.includes(logout)) return null
      return {
        callbacks: callbacks.includes(callback) ? callbacks : [...callbacks, callback],
        logouts: logouts.includes(logout) ? logouts : [...logouts, logout],
      }
    },
  })
}

/** @param {OpcoesUrl} opcoes */
export function removerUrl({
  dominio,
  clientId,
  token,
  url,
  callbackPath,
  fetchFn = globalThis.fetch,
}) {
  const { callback, logout } = urlsDoPreview(url, callbackPath)
  return atualizar({
    dominio,
    clientId,
    token,
    fetchFn,
    mudar: (callbacks, logouts) => {
      if (!callbacks.includes(callback) && !logouts.includes(logout)) return null
      return {
        callbacks: callbacks.filter((c) => c !== callback),
        logouts: logouts.filter((l) => l !== logout),
      }
    },
  })
}
