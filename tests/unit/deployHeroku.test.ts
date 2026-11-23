import { describe, it, expect, vi } from 'vitest'
import heroku, { aguardarReviewApp, tarballUrl } from '../../scripts/deploy/hosts/heroku.mjs'

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

describe('adaptador heroku: esteira (build once, promote)', () => {
  const SHA_E = 'f00dbabe1234567890'
  const TOKEN_W = 'tok-escrita-999'
  const TARBALL = 'https://codeload.github.com/o/r/legacy.tar.gz/f00d?token=URL-SECRETA-777'
  const SEGREDOS = [TOKEN_W, TARBALL, 'URL-SECRETA-777']

  type Rotas = Record<string, (body?: unknown) => Response>
  const fetchHeroku = (rotas: Rotas) =>
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const chave = `${init.method ?? 'GET'} ${url.replace('https://api.heroku.com', '')}`
      const rota = rotas[chave]
      if (!rota) return json(404, {})
      return rota(init.body ? JSON.parse(String(init.body)) : undefined)
    })

  const makeCtx = (fetchFn: unknown, extra: Record<string, unknown> = {}) => ({
    config: {
      host: 'heroku',
      heroku: { pipelineId: 'pipe-1', uatApp: 'app-uat', prodApp: 'app-prod' },
    },
    sha: SHA_E,
    github: { call: vi.fn(), location: vi.fn(async () => TARBALL) },
    log: vi.fn(),
    env: { HEROKU_DEPLOY_API_KEY: TOKEN_W },
    fetchFn: fetchFn as typeof fetch,
    ...makeClock(),
    ...extra,
  })

  const semSegredos = async (ctx: ReturnType<typeof makeCtx>, p: Promise<unknown>) => {
    const erro = await p.then(
      () => null,
      (e) => e
    )
    const textos = [
      ...ctx.log.mock.calls.map((c: unknown[]) => c.map(String).join(' ')),
      erro ? String(erro.message) : '',
    ]
    for (const texto of textos) for (const s of SEGREDOS) expect(texto).not.toContain(s)
  }

  it('promoveAposFF é false', () => expect(heroku.promoveAposFF).toBe(false))

  it('tarballUrl devolve o Location do GET /tarball/{sha}', async () => {
    const github = { location: vi.fn(async () => TARBALL) }
    expect(await tarballUrl(github, SHA_E)).toBe(TARBALL)
    expect(github.location).toHaveBeenCalledWith(`/tarball/${SHA_E}`)
  })

  describe('deployUat', () => {
    const rotasOk = (estados: string[]): Rotas => ({
      'POST /apps/app-uat/builds': () => json(201, { id: 'b-1', status: 'pending' }),
      'GET /apps/app-uat/builds/b-1': () =>
        json(200, {
          id: 'b-1',
          status: estados.shift() ?? 'succeeded',
          slug: { id: 'slug-uat' },
          source_blob: { version: SHA_E },
        }),
      'GET /apps/app-uat': () => json(200, { web_url: 'https://app-uat.herokuapp.com/' }),
    })

    it('cria build do tarball no uatApp, espera succeeded e devolve url + slug', async () => {
      const fetchFn = fetchHeroku(rotasOk(['pending']))
      const ctx = makeCtx(fetchFn)
      expect(await heroku.deployUat(ctx)).toEqual({
        url: 'https://app-uat.herokuapp.com/',
        payload: { slug: 'slug-uat' },
      })
      const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.heroku.com/apps/app-uat/builds')
      expect(init.method).toBe('POST')
      expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN_W}` })
      expect(JSON.parse(String(init.body))).toEqual({
        source_blob: { url: TARBALL, version: SHA_E },
      })
      expect(ctx.sleep).toHaveBeenCalledTimes(1)
    })

    it('a URL do tarball e o token nunca aparecem em log', async () => {
      const ctx = makeCtx(fetchHeroku(rotasOk([])))
      await semSegredos(ctx, heroku.deployUat(ctx))
      expect(ctx.log).toHaveBeenCalled()
    })

    it('build failed → erro, sem URL do tarball nem token', async () => {
      const ctx = makeCtx(fetchHeroku(rotasOk(['failed'])))
      const p = heroku.deployUat(ctx)
      await expect(p).rejects.toThrow(/Build.*app-uat.*falhou/)
      await semSegredos(ctx, p)
    })

    it('POST do build com erro HTTP → mensagem sem a URL do tarball', async () => {
      const ctx = makeCtx(
        fetchHeroku({ 'POST /apps/app-uat/builds': () => json(422, { message: 'x' }) })
      )
      const p = heroku.deployUat(ctx)
      await expect(p).rejects.toThrow(/HTTP 422/)
      await semSegredos(ctx, p)
    })

    it('sem HEROKU_DEPLOY_API_KEY → erro claro, sem chamar a API', async () => {
      const fetchFn = fetchHeroku({})
      const ctx = makeCtx(fetchFn, { env: { HEROKU_API_KEY: 'leitura' } })
      await expect(heroku.deployUat(ctx)).rejects.toThrow(/HEROKU_DEPLOY_API_KEY/)
      expect(fetchFn).not.toHaveBeenCalled()
    })

    it('401 aponta HEROKU_DEPLOY_API_KEY, sem vazar o token', async () => {
      const ctx = makeCtx(fetchHeroku({ 'POST /apps/app-uat/builds': () => json(401, {}) }))
      const p = heroku.deployUat(ctx)
      await expect(p).rejects.toThrow(/HEROKU_DEPLOY_API_KEY/)
      await semSegredos(ctx, p)
    })
  })

  it('urlUat devolve a web_url do uatApp', async () => {
    const fetchFn = fetchHeroku({
      'GET /apps/app-uat': () => json(200, { web_url: 'https://app-uat.herokuapp.com/' }),
    })
    expect(await heroku.urlUat(makeCtx(fetchFn))).toBe('https://app-uat.herokuapp.com/')
  })

  const RANGE_DESC = 'version ..; order=desc, max=50'
  const chamadas = (fetchFn: ReturnType<typeof fetchHeroku>, metodo: string, fim: string) =>
    (fetchFn.mock.calls as unknown as [string, RequestInit][]).filter(
      ([url, init]) => (init?.method ?? 'GET') === metodo && url.endsWith(fim)
    )

  describe('promoverProd', () => {
    const UUID_UAT = '11111111-1111-4111-8111-111111111111'
    const UUID_PROD = '22222222-2222-4222-8222-222222222222'
    const rotas = ({
      commit = SHA_E,
      alvo = ['pending', 'succeeded'],
      slugEmProd = 'slug-uat',
    } = {}): Rotas => ({
      // sem Range a API devolve em ordem ascendente e pode não marcar `current`
      'GET /apps/app-uat/releases': () =>
        json(200, [
          { id: 'r-1', version: 1, status: 'succeeded', slug: { id: 'slug-velho' } },
          { id: 'r-2', version: 2, status: 'succeeded', slug: { id: 'slug-uat' } },
        ]),
      'GET /apps/app-uat/slugs/slug-uat': () => json(200, { id: 'slug-uat', commit }),
      'GET /apps/app-uat': () => json(200, { id: UUID_UAT, name: 'app-uat' }),
      'GET /apps/app-prod': () => json(200, { id: UUID_PROD, name: 'app-prod' }),
      'POST /pipeline-promotions': () => json(201, { id: 'promo-1', status: 'pending' }),
      'GET /pipeline-promotions/promo-1/promotion-targets': () =>
        json(200, [{ app: { id: UUID_PROD }, status: alvo.shift() ?? 'succeeded' }]),
      'GET /apps/app-prod/releases': () =>
        json(200, [
          { id: 'p-1', version: 7, status: 'succeeded', slug: { id: 'slug-antigo' } },
          { id: 'p-2', version: 8, status: 'succeeded', slug: { id: slugEmProd } },
        ]),
    })

    it('CT-ESTEIRA-010: slug do UAT de outro commit → recusa sem promover', async () => {
      const fetchFn = fetchHeroku(rotas({ commit: 'outrosha999' }))
      const ctx = makeCtx(fetchFn)
      await expect(heroku.promoverProd(ctx)).rejects.toThrow(
        `slug do UAT não é de ${SHA_E.slice(0, 7)}`
      )
      expect(chamadas(fetchFn, 'POST', '')).toHaveLength(0)
    })

    it('lê as releases do UAT em ordem desc (Range) e o commit pelo slug, não por /builds', async () => {
      const fetchFn = fetchHeroku(rotas())
      await heroku.promoverProd(makeCtx(fetchFn))
      const [[, init]] = chamadas(fetchFn, 'GET', '/apps/app-uat/releases')
      expect(init.headers).toMatchObject({ Range: RANGE_DESC })
      expect(chamadas(fetchFn, 'GET', '/apps/app-uat/slugs/slug-uat')).toHaveLength(1)
      expect(chamadas(fetchFn, 'GET', '/builds')).toHaveLength(0)
    })

    it('slug certo → POST /pipeline-promotions com os UUIDs dos apps e espera succeeded', async () => {
      const fetchFn = fetchHeroku(rotas())
      const ctx = makeCtx(fetchFn)
      expect(await heroku.promoverProd(ctx)).toEqual({ payload: { slug: 'slug-uat' } })
      const [[, init]] = chamadas(fetchFn, 'POST', '/pipeline-promotions')
      expect(JSON.parse(String(init.body))).toEqual({
        pipeline: { id: 'pipe-1' },
        source: { app: { id: UUID_UAT } },
        targets: [{ app: { id: UUID_PROD } }],
      })
      expect(ctx.sleep).toHaveBeenCalledTimes(1)
    })

    it('depois do succeeded confere a release atual do prodApp (Range desc)', async () => {
      const fetchFn = fetchHeroku(rotas())
      await heroku.promoverProd(makeCtx(fetchFn))
      const [[, init]] = chamadas(fetchFn, 'GET', '/apps/app-prod/releases')
      expect(init.headers).toMatchObject({ Range: RANGE_DESC })
    })

    it('UAT mudou durante a promoção (prod com outro slug) → erro pedindo rollback', async () => {
      const ctx = makeCtx(fetchHeroku(rotas({ slugEmProd: 'slug-intruso' })))
      await expect(heroku.promoverProd(ctx)).rejects.toThrow(
        /prod recebeu slug diferente do verificado.*UAT mudou durante a promoção.*rollback/
      )
    })

    it('alvo da promoção failed → erro', async () => {
      const ctx = makeCtx(fetchHeroku(rotas({ alvo: ['failed'] })))
      await expect(heroku.promoverProd(ctx)).rejects.toThrow(/Promoção.*app-prod.*falhou/)
    })

    it('sem HEROKU_DEPLOY_API_KEY → erro claro', async () => {
      const ctx = makeCtx(fetchHeroku(rotas()), { env: {} })
      await expect(heroku.promoverProd(ctx)).rejects.toThrow(/HEROKU_DEPLOY_API_KEY/)
    })
  })

  describe('rollbackProd', () => {
    it('cria release no prodApp com o slug anterior ao atual (lista ascendente, sem current)', async () => {
      const fetchFn = fetchHeroku({
        'GET /apps/app-prod/releases': () =>
          json(200, [
            { version: 0, status: 'failed', slug: { id: 'slug-quebrado' } },
            { version: 1, status: 'succeeded', slug: { id: 'slug-antigo' } },
            { version: 2, status: 'succeeded', slug: { id: 'slug-novo' } },
            { version: 3, status: 'succeeded', slug: { id: 'slug-novo' } },
          ]),
        'POST /apps/app-prod/releases': () => json(201, { id: 'r-4' }),
      })
      await heroku.rollbackProd(makeCtx(fetchFn))
      const [[, get]] = chamadas(fetchFn, 'GET', '/apps/app-prod/releases')
      expect(get.headers).toMatchObject({ Range: RANGE_DESC })
      const [[url, post]] = chamadas(fetchFn, 'POST', '')
      expect(url).toBe('https://api.heroku.com/apps/app-prod/releases')
      expect(JSON.parse(String(post.body))).toEqual({ slug: 'slug-antigo' })
    })

    it('sem release anterior → erro', async () => {
      const fetchFn = fetchHeroku({
        'GET /apps/app-prod/releases': () =>
          json(200, [{ version: 1, status: 'succeeded', current: true, slug: { id: 's' } }]),
      })
      await expect(heroku.rollbackProd(makeCtx(fetchFn))).rejects.toThrow(/sem release anterior/)
    })
  })

  describe('deployProd (hotfix)', () => {
    it('com prodApp: build do tarball no prodApp e espera succeeded', async () => {
      const fetchFn = fetchHeroku({
        'POST /apps/app-prod/builds': () => json(201, { id: 'b-9' }),
        'GET /apps/app-prod/builds/b-9': () =>
          json(200, { id: 'b-9', status: 'succeeded', slug: { id: 'slug-hotfix' } }),
      })
      const ctx = makeCtx(fetchFn)
      await heroku.deployProd(ctx)
      const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
      expect(JSON.parse(String(init.body))).toEqual({
        source_blob: { url: TARBALL, version: SHA_E },
      })
      await semSegredos(ctx, Promise.resolve())
    })

    it('sem prodApp (sem esteira) → no-op, como hoje', async () => {
      const fetchFn = fetchHeroku({})
      await heroku.deployProd({
        ...makeCtx(fetchFn),
        config: { host: 'heroku', heroku: { pipelineId: 'pipe-1' } },
        env: {},
      })
      expect(fetchFn).not.toHaveBeenCalled()
    })
  })
})
