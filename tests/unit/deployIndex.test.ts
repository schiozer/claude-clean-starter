import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executar, adaptador, execReal, OPERACOES } from '../../scripts/deploy/index.mjs'

const dirs: string[] = []
const raizCom = (config: object) => {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'deploy.config.json'), JSON.stringify(config))
  return dir
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

const github = { call: vi.fn(), paginate: vi.fn() }
const amb = (p: string) => ({
  project: `app-${p}`,
  service: `svc-${p}`,
  wifProvider: `wif-${p}`,
  serviceAccount: `sa-${p}`,
})
let ctxVercel: Record<string, unknown>
let ctxCloudRun: Record<string, unknown>
let envDe: (host: string) => Record<string, string>
const raizes: Record<string, string> = {}

beforeAll(() => {
  raizes.vercel = raizCom({ host: 'vercel' })
  raizes.heroku = raizCom({ host: 'heroku', heroku: { pipelineId: 'pipe-1' } })
  const raizCr = raizCom({
    host: 'cloudrun',
    cloudrun: { region: 'us-central1', repository: 'repo', uat: amb('uat'), prod: amb('prod') },
  })
  const exec = vi.fn()
  ctxVercel = { env: {}, raiz: raizes.vercel, exec, github }
  ctxCloudRun = { env: {}, raiz: raizCr, exec, github }
  envDe = () => ({ PR_NUMBER: '1', DEPLOY_SHA: 'abc' })
})

describe('executar', () => {
  it.each(['vercel', 'heroku'])('%s: preview/prod/encerrar são no-op', async (host) => {
    const exec = vi.fn()
    for (const op of ['preview', 'prod', 'encerrar']) {
      await executar(op, { env: envDe(host), raiz: raizes[host], exec, github })
    }
    expect(exec).not.toHaveBeenCalled()
  })
  it('host → grava o host da config', async () =>
    expect(await executar('host', ctxCloudRun as never)).toEqual({ host: 'cloudrun' }))
  it('credenciais fora do cloudrun → vazio', async () =>
    expect(await executar('credenciais', ctxVercel as never)).toEqual({}))
  it('credenciais cloudrun prod → dados do bloco prod', async () => {
    const r = await executar('credenciais', {
      ...ctxCloudRun,
      env: { DEPLOY_AMBIENTE: 'prod' },
    } as never)
    expect(r).toEqual({
      wifProvider: 'wif-prod',
      serviceAccount: 'sa-prod',
      project: 'app-prod',
      region: 'us-central1',
    })
  })
  it('operação desconhecida → erro listando as válidas', async () =>
    await expect(executar('deploy', ctxVercel as never)).rejects.toThrow(
      /host, credenciais, preview, prod, encerrar, aguardar/
    ))
  it('aguardar com heroku sem PR_NUMBER → erro', async () =>
    await expect(
      executar('aguardar', {
        env: { PREVIEW_SHA: 'abc' },
        raiz: raizes.heroku,
        exec: vi.fn(),
        github,
      })
    ).rejects.toThrow(/PR_NUMBER/))
  it('aguardar com vercel não exige PR_NUMBER', async () => {
    const api = {
      call: vi.fn(async (_m: string, path: string) =>
        path.includes('/statuses')
          ? [{ state: 'success', environment_url: 'https://v.example' }]
          : [{ id: 1, environment: 'Preview', created_at: '2026-11-10T10:00:00Z' }]
      ),
    }
    const r = await executar('aguardar', {
      env: { PREVIEW_SHA: 'abc' },
      raiz: raizes.vercel,
      exec: vi.fn(),
      github: api,
    })
    expect(r).toEqual({ url: 'https://v.example' })
  })
  it('aguardar usa adapter.aguardarPreview quando definido', async () => {
    const heroku = adaptador('heroku')
    heroku.aguardarPreview = async () => 'https://x.example'
    try {
      const r = await executar('aguardar', {
        env: { PREVIEW_SHA: 'abc', PR_NUMBER: '7' },
        raiz: raizes.heroku,
        exec: vi.fn(),
        github,
      })
      expect(r).toEqual({ url: 'https://x.example' })
    } finally {
      delete heroku.aguardarPreview
    }
  })
})

describe('executar: validações', () => {
  it.each(['preview', 'encerrar'])('%s sem PR_NUMBER válido → erro claro', async (op) => {
    for (const PR_NUMBER of [undefined, 'abc', '0', '-3', '1.5']) {
      const env = { DEPLOY_SHA: 'abc', ...(PR_NUMBER === undefined ? {} : { PR_NUMBER }) }
      await expect(
        executar(op, { env, raiz: raizes.vercel, exec: vi.fn(), github })
      ).rejects.toThrow(/deploy: PR_NUMBER deve ser um inteiro positivo/)
    }
  })
  it('prod não exige PR_NUMBER', async () =>
    expect(
      await executar('prod', { env: { DEPLOY_SHA: 'abc' }, raiz: raizes.vercel, exec: vi.fn() })
    ).toEqual({}))
  it('aguardar sem aguardarPreview e sem github → erro pedindo GITHUB_TOKEN', async () =>
    await expect(
      executar('aguardar', { env: { PREVIEW_SHA: 'abc' }, raiz: raizes.vercel, exec: vi.fn() })
    ).rejects.toThrow(/GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios/))
})

describe('adaptador', () => {
  it('vercel: ambienteDePreview = startsWith Preview', () =>
    expect(adaptador('vercel').ambienteDePreview('Preview – app')).toBe(true))
  it('heroku: ambienteDePreview sempre falso', () =>
    expect(adaptador('heroku').ambienteDePreview('Preview')).toBe(false))
  it('cloudrun: resolve o adaptador registrado', () =>
    expect(adaptador('cloudrun').nome).toBe('cloudrun'))
  it('host desconhecido/sem adaptador → erro claro', () =>
    expect(() => adaptador('netlify')).toThrow(/deploy: adaptador 'netlify'/))
})

describe('executar: Auth0 de UAT (heroku)', () => {
  const AUTH0 = {
    AUTH0_MGMT_DOMAIN: 'x.auth0.com',
    AUTH0_MGMT_CLIENT_ID: 'm',
    AUTH0_MGMT_CLIENT_SECRET: 's',
    AUTH0_WEB_CLIENT_ID: 'web',
  }
  const URL_PR = 'https://app-pr-1.herokuapp.com'
  const json = (corpo: unknown, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => corpo,
  })
  const fetchFake = (reviewApps: unknown[] = [], appStatus = 200) =>
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.endsWith('/oauth/token')) return json({ access_token: 'tok' })
      if (url.includes('/review-apps')) return json(reviewApps)
      if (url.includes('api.heroku.com/apps/')) return json({ web_url: URL_PR }, appStatus)
      if (init?.method === 'PATCH') return json({})
      return json({ callbacks: [], allowed_logout_urls: [] })
    })
  const chamou = (f: ReturnType<typeof fetchFake>, trecho: string) =>
    f.mock.calls.some((c) => String(c[0]).includes(trecho))
  const comAguardar = async (fn: () => Promise<unknown>) => {
    const heroku = adaptador('heroku')
    heroku.aguardarPreview = async () => URL_PR
    try {
      return await fn()
    } finally {
      delete heroku.aguardarPreview
    }
  }
  const envAguardar = { PR_NUMBER: '1', PREVIEW_SHA: 'abc' }

  it('heroku aguardar com todas as variáveis → registra a URL', async () => {
    const f = fetchFake()
    await comAguardar(() =>
      executar('aguardar', {
        env: { ...envAguardar, ...AUTH0 },
        raiz: raizes.heroku,
        fetchFn: f as never,
      })
    )
    expect(chamou(f, '/api/v2/clients/web')).toBe(true)
    expect(f.mock.calls.some((c) => (c[1] as { method?: string })?.method === 'PATCH')).toBe(true)
  })
  it('heroku aguardar sem variáveis → pula o Auth0', async () => {
    const f = fetchFake()
    const r = await comAguardar(() =>
      executar('aguardar', { env: envAguardar, raiz: raizes.heroku, fetchFn: f as never })
    )
    expect(r).toEqual({ url: URL_PR })
    expect(f).not.toHaveBeenCalled()
  })
  it('heroku aguardar com variáveis parciais → erro', async () => {
    const f = fetchFake()
    await expect(
      comAguardar(() =>
        executar('aguardar', {
          env: { ...envAguardar, AUTH0_MGMT_DOMAIN: 'x.auth0.com' },
          raiz: raizes.heroku,
          fetchFn: f as never,
        })
      )
    ).rejects.toThrow(/AUTH0_MGMT_CLIENT_ID/)
  })
  it('heroku aguardar com config parcial falha antes de esperar o review app', async () => {
    const f = fetchFake()
    const heroku = adaptador('heroku')
    const espera = vi.fn(async () => URL_PR)
    heroku.aguardarPreview = espera
    try {
      await expect(
        executar('aguardar', {
          env: { ...envAguardar, AUTH0_MGMT_DOMAIN: 'x.auth0.com' },
          raiz: raizes.heroku,
          fetchFn: f as never,
        })
      ).rejects.toThrow(/AUTH0_MGMT_CLIENT_ID/)
    } finally {
      delete heroku.aguardarPreview
    }
    expect(espera).not.toHaveBeenCalled()
    expect(f).not.toHaveBeenCalled()
  })
  it('vercel aguardar nunca toca o Auth0', async () => {
    const f = fetchFake()
    const api = {
      call: vi.fn(async (_m: string, path: string) =>
        path.includes('/statuses')
          ? [{ state: 'success', environment_url: 'https://v.example' }]
          : [{ id: 1, environment: 'Preview', created_at: '2026-11-10T10:00:00Z' }]
      ),
    }
    const r = await executar('aguardar', {
      env: { PREVIEW_SHA: 'abc', ...AUTH0 },
      raiz: raizes.vercel,
      github: api as never,
      fetchFn: f as never,
    })
    expect(r).toEqual({ url: 'https://v.example' })
    expect(f).not.toHaveBeenCalled()
  })
  it('heroku encerrar remove a URL do review app', async () => {
    const f = fetchFake([{ pr_number: 1, status: 'created', app: { id: 'a1' } }])
    await executar('encerrar', {
      env: { PR_NUMBER: '1', DEPLOY_SHA: 'abc', HEROKU_API_KEY: 'h', ...AUTH0 },
      raiz: raizes.heroku,
      fetchFn: f as never,
    })
    expect(chamou(f, '/oauth/token')).toBe(true)
  })
  it('heroku encerrar com review app já removido → sucesso sem tocar o Auth0', async () => {
    const f = fetchFake([])
    await executar('encerrar', {
      env: { PR_NUMBER: '1', DEPLOY_SHA: 'abc', HEROKU_API_KEY: 'h', ...AUTH0 },
      raiz: raizes.heroku,
      fetchFn: f as never,
    })
    expect(chamou(f, 'auth0.com')).toBe(false)
  })
})

describe('executar: esteira (uat / promover)', () => {
  const ESTEIRA = {
    integracao: 'develop',
    producao: 'main',
    prefixoHotfix: 'hotfix/',
    promotores: ['fulano'],
  }
  const raizEsteira = (deploy: object, esteira: object | null = ESTEIRA) => {
    const dir = raizCom(deploy)
    mkdirSync(join(dir, 'hooks/protect-main'), { recursive: true })
    writeFileSync(
      join(dir, 'hooks/protect-main/config.json'),
      JSON.stringify({ protectedBranches: ['main'], ...(esteira ? { esteira } : {}) })
    )
    return dir
  }
  const VERCEL = { host: 'vercel', vercel: { uatAlias: 'uat.example', team: 'time' } }

  it('OPERACOES inclui uat e promover', () => {
    expect(OPERACOES).toEqual(expect.arrayContaining(['uat', 'promover']))
  })

  it('com esteira, valida o deploy.config para a esteira (heroku sem uatApp → erro)', async () => {
    const raiz = raizEsteira({ host: 'heroku', heroku: { pipelineId: 'p' } })
    await expect(executar('host', { env: {}, raiz })).rejects.toThrow(
      /heroku.uatApp obrigatório com a esteira/
    )
  })

  it('sem esteira, o mesmo deploy.config continua válido (como hoje)', async () => {
    const raiz = raizEsteira({ host: 'heroku', heroku: { pipelineId: 'p' } }, null)
    expect(await executar('host', { env: {}, raiz })).toEqual({ host: 'heroku' })
  })

  it('uat: deployUat do SHA e registra o Deployment uat com o payload do host', async () => {
    const raiz = raizEsteira(VERCEL)
    const vercel = adaptador('vercel')
    const original = vercel.deployUat
    const deployUat = vi.fn(async () => ({
      url: 'https://uat.example',
      payload: { deploymentId: 3, url: 'https://uat.example' },
    }))
    vercel.deployUat = deployUat
    const call = vi.fn(async (method: string, path: string) =>
      method === 'POST' && path === '/deployments' ? { id: 42 } : {}
    )
    try {
      const r = await executar('uat', {
        env: { DEPLOY_SHA: 'abc' },
        raiz,
        exec: vi.fn(),
        github: { call } as never,
      })
      expect(r).toEqual({ url: 'https://uat.example' })
    } finally {
      vercel.deployUat = original
    }
    expect(deployUat).toHaveBeenCalledWith(
      expect.objectContaining({ sha: 'abc', esteira: ESTEIRA, env: { DEPLOY_SHA: 'abc' } })
    )
    expect(call).toHaveBeenCalledWith('POST', '/deployments', {
      ref: 'abc',
      environment: 'uat',
      payload: { sha: 'abc', deploymentId: 3, url: 'https://uat.example' },
      auto_merge: false,
      required_contexts: [],
    })
    expect(call).toHaveBeenCalledWith('POST', '/deployments/42/statuses', {
      state: 'success',
      environment_url: 'https://uat.example',
    })
  })

  it('uat sem esteira → erro claro', async () => {
    const raiz = raizEsteira(VERCEL, null)
    await expect(
      executar('uat', { env: { DEPLOY_SHA: 'abc' }, raiz, github: { call: vi.fn() } as never })
    ).rejects.toThrow(/deploy: a operação uat exige o bloco esteira/)
  })

  it('promover sem esteira → não promove (aviso, sai ok)', async () => {
    const raiz = raizEsteira(VERCEL, null)
    expect(await executar('promover', { env: {}, raiz })).toEqual({ promovido: 'false' })
  })
})

describe('execReal', () => {
  it('repassa o env do 3º argumento somado ao do processo', async () => {
    const saida = await execReal(
      process.execPath,
      ['-e', 'process.stdout.write(`${process.env.X_TESTE}:${Boolean(process.env.PATH)}`)'],
      { env: { X_TESTE: 'ok' } }
    )
    expect(saida).toBe('ok:true')
  })
  it('falha preserva o código de saída', async () => {
    await expect(execReal(process.execPath, ['-e', 'process.exit(3)'])).rejects.toMatchObject({
      code: 3,
    })
  })
})
