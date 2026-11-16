import { describe, it, expect, vi } from 'vitest'
import heroku, { aguardarReviewApp } from '../../scripts/deploy/hosts/heroku.mjs'

const SHA = 'abc1234def'
const TOKEN = 'segredo-token-123'
const PR = 12

const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

const makeClock = () => {
  const clock = { t: 0 }
  const sleep = vi.fn(async (ms: number) => {
    clock.t += ms
  })
  return { now: () => clock.t, sleep }
}

const revApp = (extra = {}) => ({
  id: 'ra-1',
  pr_number: PR,
  status: 'created',
  app: { id: 'app-1' },
  created_at: '2026-11-10T10:00:00Z',
  ...extra,
})
const build = (extra = {}) => ({
  status: 'succeeded',
  source_blob: { version: SHA },
  created_at: '2026-11-10T10:05:00Z',
  ...extra,
})

type Fontes = { reviewApps?: () => Response; builds?: () => Response }
const roteador = ({ reviewApps, builds }: Fontes) =>
  vi.fn(async (url: string) => {
    if (url.endsWith('/review-apps')) return (reviewApps ?? (() => json(200, [revApp()])))()
    if (url.endsWith('/apps/app-1/builds')) return (builds ?? (() => json(200, [build()])))()
    if (url.endsWith('/apps/app-1'))
      return json(200, { web_url: 'https://app-pr-12.herokuapp.com/' })
    return json(404, {})
  })

const opts = (fetchFn: unknown, extra = {}) => ({
  sha: SHA,
  pr: PR,
  pipelineId: 'pipe-1',
  token: TOKEN,
  fetchFn: fetchFn as typeof fetch,
  ...makeClock(),
  timeoutMs: 60_000,
  intervalMs: 10_000,
  ...extra,
})

const semToken = (p: Promise<unknown>) =>
  p.catch((e) => expect(String(e.message)).not.toContain(TOKEN))

describe('aguardarReviewApp', () => {
  it('created + build mais novo succeeded do SHA → URL, com os headers da Platform API', async () => {
    const fetchFn = roteador({})
    expect(await aguardarReviewApp(opts(fetchFn))).toEqual({
      url: 'https://app-pr-12.herokuapp.com/',
    })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.heroku.com/pipelines/pipe-1/review-apps')
    expect(init.headers).toMatchObject({
      Accept: 'application/vnd.heroku+json; version=3',
      Authorization: `Bearer ${TOKEN}`,
    })
  })

  it('build de SHA antigo → continua esperando até o build novo aparecer', async () => {
    let n = 0
    const fetchFn = roteador({
      builds: () => {
        n++
        return json(200, [
          build({ source_blob: { version: 'velho' }, created_at: '2026-11-10T09:00:00Z' }),
          ...(n > 1 ? [build()] : []),
        ])
      },
    })
    const o = opts(fetchFn)
    expect((await aguardarReviewApp(o)).url).toContain('herokuapp')
    expect(o.sleep).toHaveBeenCalledTimes(1)
  })

  it('build pending → espera; build failed → erro', async () => {
    const pending = roteador({ builds: () => json(200, [build({ status: 'pending' })]) })
    await expect(aguardarReviewApp(opts(pending))).rejects.toThrow(/não ficou pronto/)
    const failed = roteador({ builds: () => json(200, [build({ status: 'failed' })]) })
    await expect(aguardarReviewApp(opts(failed))).rejects.toThrow(/Build.*falhou.*failed/)
  })

  it('review app errored → erro com message/error_status, sem token', async () => {
    const fetchFn = roteador({
      reviewApps: () =>
        json(200, [revApp({ status: 'errored', message: 'app.json inválido', error_status: 'x' })]),
    })
    const p = aguardarReviewApp(opts(fetchFn))
    await expect(p).rejects.toThrow(/errored.*app\.json inválido/)
    await semToken(p)
  })

  it.each(['deleting', 'deleted'])('review app %s → erro (PR fechado)', async (status) => {
    const fetchFn = roteador({ reviewApps: () => json(200, [revApp({ status })]) })
    await expect(aguardarReviewApp(opts(fetchFn))).rejects.toThrow(/removido.*PR foi fechado/)
  })

  it('created sem app.id → erro explícito', async () => {
    const fetchFn = roteador({ reviewApps: () => json(200, [revApp({ app: null })]) })
    await expect(aguardarReviewApp(opts(fetchFn))).rejects.toThrow(/sem app/)
  })

  it('ignora review app de outro PR', async () => {
    const fetchFn = roteador({
      reviewApps: () =>
        json(200, [revApp({ pr_number: 99, status: 'errored' }), revApp({ id: 'ra-2' })]),
    })
    expect((await aguardarReviewApp(opts(fetchFn))).url).toContain('herokuapp')
  })

  it('dois review apps do mesmo PR → usa o mais novo por created_at', async () => {
    const fetchFn = roteador({
      reviewApps: () =>
        json(200, [
          revApp({ created_at: '2026-11-11T10:00:00Z' }),
          revApp({ status: 'errored', created_at: '2026-11-09T10:00:00Z' }),
        ]),
    })
    expect((await aguardarReviewApp(opts(fetchFn))).url).toContain('herokuapp')
  })

  it('503 e 429 são transitórios: tenta de novo', async () => {
    const respostas = [json(503, {}), json(429, {})]
    const fetchFn = roteador({
      reviewApps: () => respostas.shift() ?? json(200, [revApp()]),
    })
    expect((await aguardarReviewApp(opts(fetchFn))).url).toContain('herokuapp')
  })

  it('401 falha rápido, sem retentativa e sem vazar o token', async () => {
    const fetchFn = roteador({ reviewApps: () => json(401, {}) })
    const o = opts(fetchFn)
    const p = aguardarReviewApp(o)
    await expect(p).rejects.toThrow(/HEROKU_API_KEY/)
    await semToken(p)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(o.sleep).not.toHaveBeenCalled()
  })

  it('timeout com a mensagem no estilo da espera do GitHub', async () => {
    const fetchFn = roteador({ reviewApps: () => json(200, [revApp({ status: 'creating' })]) })
    await expect(aguardarReviewApp(opts(fetchFn))).rejects.toThrow(
      new RegExp(`Review app para ${SHA} não ficou pronto em 1 min`)
    )
  })

  it('sem review app do PR até o prazo → "Nenhum review app"', async () => {
    const fetchFn = roteador({ reviewApps: () => json(200, []) })
    await expect(aguardarReviewApp(opts(fetchFn))).rejects.toThrow(/Nenhum review app para/)
  })
})

describe('adaptador heroku', () => {
  it('sem HEROKU_API_KEY → erro claro', async () =>
    await expect(
      heroku.aguardarPreview({
        config: { host: 'heroku', heroku: { pipelineId: 'pipe-1' } },
        sha: SHA,
        pr: PR,
        env: {},
      })
    ).rejects.toThrow(/HEROKU_API_KEY/))
})
