import { describe, it, expect, vi } from 'vitest'
import {
  lerConfigAuth0,
  obterToken,
  registrarUrl,
  removerUrl,
} from '../../scripts/deploy/auth0Callbacks.mjs'

const URL_PR = 'https://app-pr-7.herokuapp.com'
const CB = `${URL_PR}/api/auth/callback`
const resp = (status: number, corpo: unknown = {}) => ({
  ok: status < 400,
  status,
  json: async () => corpo,
})
const base = { dominio: 'x.auth0.com', clientId: 'web', token: 'SEGREDO-TOKEN', url: URL_PR }

const fetchCom = (cliente: object, patch = resp(200)) =>
  vi.fn(async (_u: string, init?: { method?: string }) =>
    init?.method === 'PATCH' ? patch : resp(200, cliente)
  )
const patchDe = (f: ReturnType<typeof fetchCom>) =>
  f.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'PATCH')

describe('registrarUrl', () => {
  it('soma callback e logout sem duplicar e só envia os dois campos', async () => {
    const f = fetchCom({ callbacks: ['https://uat/cb', 'https://*.x/cb'], allowed_logout_urls: [] })
    const r = await registrarUrl({ ...base, url: `${URL_PR}/`, fetchFn: f as never })
    expect(r.alterado).toBe(true)
    const corpo = JSON.parse((patchDe(f)![1] as { body: string }).body)
    expect(corpo).toEqual({
      callbacks: ['https://uat/cb', 'https://*.x/cb', CB],
      allowed_logout_urls: [URL_PR],
    })
  })
  it('idempotente: já presente → sem PATCH', async () => {
    const f = fetchCom({ callbacks: [CB], allowed_logout_urls: [URL_PR] })
    expect((await registrarUrl({ ...base, fetchFn: f as never })).alterado).toBe(false)
    expect(patchDe(f)).toBeUndefined()
  })
  it('usa callbackPath customizado sem barra dupla', async () => {
    const f = fetchCom({ callbacks: [], allowed_logout_urls: [] })
    await registrarUrl({ ...base, callbackPath: '/auth/cb', fetchFn: f as never })
    const corpo = JSON.parse((patchDe(f)![1] as { body: string }).body)
    expect(corpo.callbacks).toEqual([`${URL_PR}/auth/cb`])
  })
  it('erro HTTP não vaza o token', async () => {
    const f = fetchCom({}, resp(500))
    const erro = await registrarUrl({ ...base, fetchFn: f as never }).catch((e) => e)
    expect(erro.message).toContain('HTTP 500')
    expect(erro.message).not.toContain('SEGREDO-TOKEN')
  })
})

describe('removerUrl', () => {
  it('remove só as entradas do PR e mantém curingas e outras URLs', async () => {
    const f = fetchCom({
      callbacks: ['https://*.x/cb', CB, 'https://app-pr-8.herokuapp.com/api/auth/callback'],
      allowed_logout_urls: [URL_PR, 'https://uat'],
    })
    await removerUrl({ ...base, fetchFn: f as never })
    const corpo = JSON.parse((patchDe(f)![1] as { body: string }).body)
    expect(corpo).toEqual({
      callbacks: ['https://*.x/cb', 'https://app-pr-8.herokuapp.com/api/auth/callback'],
      allowed_logout_urls: ['https://uat'],
    })
  })
  it('idempotente: ausente → sem PATCH', async () => {
    const f = fetchCom({ callbacks: ['https://uat/cb'], allowed_logout_urls: [] })
    expect((await removerUrl({ ...base, fetchFn: f as never })).alterado).toBe(false)
    expect(patchDe(f)).toBeUndefined()
  })
})

describe('obterToken', () => {
  it('client credentials com audience da Management API', async () => {
    const f = vi.fn(async () => resp(200, { access_token: 'tok' }))
    expect(
      await obterToken({
        dominio: 'x.auth0.com',
        clientId: 'm',
        clientSecret: 's',
        fetchFn: f as never,
      })
    ).toBe('tok')
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toBe('https://x.auth0.com/oauth/token')
    expect(JSON.parse(init.body).audience).toBe('https://x.auth0.com/api/v2/')
  })
  it('erro não vaza o client secret', async () => {
    const f = vi.fn(async () => resp(401))
    const erro = await obterToken({
      dominio: 'x.auth0.com',
      clientId: 'm',
      clientSecret: 'SEGREDO-CLIENTE',
      fetchFn: f as never,
    }).catch((e) => e)
    expect(erro.message).toBe('Auth0: HTTP 401 em /oauth/token')
  })
})

describe('lerConfigAuth0', () => {
  it('nenhuma variável → null', () => expect(lerConfigAuth0({})).toBeNull())
  it('parcial → erro nomeando as que faltam', () =>
    expect(() => lerConfigAuth0({ AUTH0_MGMT_DOMAIN: 'x' })).toThrow(
      /AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET, AUTH0_WEB_CLIENT_ID/
    ))
})
