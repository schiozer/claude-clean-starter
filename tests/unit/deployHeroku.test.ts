import { describe, it, expect, vi } from 'vitest'
import heroku, { aguardarReviewApp } from '../../scripts/deploy/hosts/heroku.mjs'

const SHA = 'abc1234def'
const TOKEN = 'segredo-token-123'

const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

const makeClock = () => {
  const clock = { t: 0 }
  const sleep = vi.fn(async (ms: number) => {
    clock.t += ms
  })
  return { now: () => clock.t, sleep }
}

const roteador = (reviewApps: () => Response) =>
  vi.fn(async (url: string) => {
    if (url.endsWith('/review-apps')) return reviewApps()
    if (url.endsWith('/apps/app-1'))
      return json(200, { web_url: 'https://app-pr-1.herokuapp.com/' })
    return json(404, {})
  })

const opts = (fetchFn: unknown, extra = {}) => ({
  sha: SHA,
  pipelineId: 'pipe-1',
  token: TOKEN,
  fetchFn: fetchFn as typeof fetch,
  ...makeClock(),
  timeoutMs: 60_000,
  intervalMs: 10_000,
  ...extra,
})

describe('aguardarReviewApp', () => {
  it('created → web_url, com os headers da Platform API', async () => {
    const fetchFn = roteador(() =>
      json(200, [{ commit: SHA, status: 'created', app: { id: 'app-1' } }])
    )
    expect(await aguardarReviewApp(opts(fetchFn))).toEqual({
      url: 'https://app-pr-1.herokuapp.com/',
    })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.heroku.com/pipelines/pipe-1/review-apps')
    expect(init.headers).toMatchObject({
      Accept: 'application/vnd.heroku+json; version=3',
      Authorization: `Bearer ${TOKEN}`,
    })
  })

  it('errored → erro sem vazar o token', async () => {
    const fetchFn = roteador(() =>
      json(200, [{ commit: SHA, status: 'errored', app: null, error_status: 'x' }])
    )
    const p = aguardarReviewApp(opts(fetchFn))
    await expect(p).rejects.toThrow(/review app.*falhou/i)
    await p.catch((e) => expect(String(e.message)).not.toContain(TOKEN))
  })

  it('ignora review app de outro SHA e espera o certo', async () => {
    let n = 0
    const fetchFn = roteador(() => {
      n++
      return json(200, [
        { commit: 'outro', status: 'created', app: { id: 'zzz' } },
        ...(n > 1 ? [{ commit: SHA, status: 'created', app: { id: 'app-1' } }] : []),
      ])
    })
    const o = opts(fetchFn)
    expect((await aguardarReviewApp(o)).url).toBe('https://app-pr-1.herokuapp.com/')
    expect(o.sleep).toHaveBeenCalledTimes(1)
  })

  it('503 e 429 são transitórios: tenta de novo', async () => {
    const respostas = [json(503, {}), json(429, {})]
    const fetchFn = roteador(
      () =>
        respostas.shift() ?? json(200, [{ commit: SHA, status: 'created', app: { id: 'app-1' } }])
    )
    expect((await aguardarReviewApp(opts(fetchFn))).url).toContain('herokuapp')
  })

  it('401 falha rápido, sem retentativa e sem vazar o token', async () => {
    const fetchFn = roteador(() => json(401, {}))
    const o = opts(fetchFn)
    const p = aguardarReviewApp(o)
    await expect(p).rejects.toThrow(/HEROKU_API_KEY/)
    await p.catch((e) => expect(String(e.message)).not.toContain(TOKEN))
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(o.sleep).not.toHaveBeenCalled()
  })

  it('timeout com a mensagem no estilo da espera do GitHub', async () => {
    const fetchFn = roteador(() => json(200, [{ commit: SHA, status: 'creating', app: null }]))
    await expect(aguardarReviewApp(opts(fetchFn))).rejects.toThrow(
      new RegExp(`Review app para ${SHA} não ficou pronto em 1 min`)
    )
  })

  it('sem review app algum até o prazo → "Nenhum review app"', async () => {
    const fetchFn = roteador(() => json(200, []))
    await expect(aguardarReviewApp(opts(fetchFn))).rejects.toThrow(/Nenhum review app para/)
  })
})

describe('adaptador heroku', () => {
  const ctx = (env: Record<string, string>) => ({
    config: { host: 'heroku', heroku: { pipelineId: 'pipe-1' } },
    sha: SHA,
    env,
  })
  it('sem HEROKU_API_KEY → erro claro', async () =>
    await expect(heroku.aguardarPreview(ctx({}))).rejects.toThrow(/HEROKU_API_KEY/))
})
