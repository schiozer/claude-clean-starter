import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executar, adaptador } from '../../scripts/deploy/index.mjs'

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
  it('aguardar usa adapter.aguardarPreview quando definido', async () => {
    const heroku = adaptador('heroku')
    heroku.aguardarPreview = async () => 'https://x.example'
    try {
      const r = await executar('aguardar', {
        env: { PREVIEW_SHA: 'abc' },
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
