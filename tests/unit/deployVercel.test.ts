import { describe, it, expect, vi } from 'vitest'
import vercel from '../../scripts/deploy/hosts/vercel.mjs'

const SHA = 'cafe1234567890abcdef'
const TOKEN = 'vercel-token-segredo-42'
const config = { host: 'vercel', vercel: { uatAlias: 'app-uat.vercel.app', team: 'meu-time' } }

type Deployment = { id: number; environment: string; sha: string; ref?: string; created_at: string }
type Status = { state: string; environment_url?: string }

const makeClock = () => {
  const clock = { t: 0 }
  const sleep = vi.fn(async (ms: number) => {
    clock.t += ms
  })
  return { now: () => clock.t, sleep }
}

/** GitHub fake: `/deployments?sha=` devolve `deployments()`; statuses por id em `statuses`. */
const githubFake = (deployments: () => Deployment[], statuses: Record<number, () => Status[]>) => ({
  call: vi.fn(async (_m: string, path: string) => {
    if (path.startsWith('/deployments?sha=')) return deployments()
    const id = Number(/\/deployments\/(\d+)\/statuses/.exec(path)?.[1])
    return statuses[id]?.() ?? []
  }),
})

const ctxDe = (over: Record<string, unknown> = {}) => ({
  config,
  sha: SHA,
  exec: vi.fn(async () => ''),
  log: vi.fn(),
  env: { VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: 'team_org', VERCEL_PROJECT_ID: 'prj_app' },
  ...makeClock(),
  timeoutMs: 60_000,
  intervalMs: 10_000,
  ...over,
})

const dep = (
  id: number,
  environment: string,
  ref = SHA,
  quando = '2026-11-23T10:00:00Z',
  sha = SHA
) => ({
  id,
  environment,
  sha,
  ref,
  created_at: quando,
})

describe('vercel: contrato da esteira', () => {
  it('promoveAposFF é true (o FF da main dispara o build de Production)', () =>
    expect(vercel.promoveAposFF).toBe(true))

  it('sem esteira: preview segue casando Preview* e deploys seguem no-op', async () => {
    expect(vercel.ambienteDePreview('Preview – app')).toBe(true)
    expect(vercel.ambienteDePreview('Production')).toBe(false)
    await expect(vercel.deployProd()).resolves.toBeUndefined()
  })
})

describe('vercel: deployUat', () => {
  it('espera o deploy Preview do SHA (ref = SHA, como grava a Vercel) e devolve url + payload', async () => {
    const github = githubFake(
      () => [
        dep(1, 'Preview – app', SHA, '2026-11-23T11:00:00Z', 'outro-sha'),
        dep(2, 'Preview – app', SHA),
      ],
      {
        1: () => [{ state: 'success', environment_url: 'https://app-outro.vercel.app' }],
        2: () => [{ state: 'success', environment_url: 'https://app-abc.vercel.app' }],
      }
    )
    const r = await vercel.deployUat(ctxDe({ github }) as never)
    expect(r).toEqual({
      url: 'https://app-abc.vercel.app',
      payload: { deploymentId: 2, url: 'https://app-abc.vercel.app' },
    })
    expect(github.call).toHaveBeenCalledWith('GET', `/deployments?sha=${SHA}&per_page=100`)
  })

  it('casa o Custom Environment uat com sufixo de projeto (uat – app)', async () => {
    const github = githubFake(() => [dep(3, 'uat – app', 'develop')], {
      3: () => [{ state: 'success', environment_url: 'https://app-uat-x.vercel.app' }],
    })
    const r = await vercel.deployUat(ctxDe({ github }) as never)
    expect(r.url).toBe('https://app-uat-x.vercel.app')
  })

  it('não casa Production nem deploy de outro SHA → timeout com erro claro', async () => {
    const github = githubFake(
      () => [dep(1, 'Production – app'), dep(2, 'Preview – app', 'develop', undefined, 'outro')],
      {
        1: () => [{ state: 'success', environment_url: 'https://x' }],
        2: () => [{ state: 'success', environment_url: 'https://y' }],
      }
    )
    await expect(vercel.deployUat(ctxDe({ github }) as never)).rejects.toThrow(
      /Nenhum deploy de UAT para cafe123/
    )
  })

  it('sem cliente GitHub → erro claro', async () =>
    await expect(vercel.deployUat(ctxDe({ github: undefined }) as never)).rejects.toThrow(
      /GITHUB_TOKEN/
    ))
})

describe('vercel: urlUat', () => {
  it('devolve o alias de config.vercel.uatAlias como URL https', async () =>
    expect(await vercel.urlUat(ctxDe() as never)).toBe('https://app-uat.vercel.app'))

  it('alias já com esquema → como está', async () =>
    expect(
      await vercel.urlUat(
        ctxDe({
          config: { ...config, vercel: { ...config.vercel, uatAlias: 'https://uat.x.com' } },
        }) as never
      )
    ).toBe('https://uat.x.com'))
})

describe('vercel: promoverProd (CT-ESTEIRA-012)', () => {
  it('espera o Deployment Production do SHA chegar a success', async () => {
    let n = 0
    const github = githubFake(() => [dep(9, 'Production', 'main')], {
      9: () =>
        ++n < 3
          ? [{ state: 'in_progress' }]
          : [{ state: 'success', environment_url: 'https://app.com' }],
    })
    const ctx = ctxDe({ github })
    expect(await vercel.promoverProd(ctx as never)).toEqual({
      payload: { deploymentId: 9, url: 'https://app.com' },
    })
    expect(ctx.sleep).toHaveBeenCalledTimes(2)
    expect(ctx.exec).not.toHaveBeenCalled()
  })

  it('casa Production com sufixo de projeto (repo com mais de um projeto Vercel)', async () => {
    const github = githubFake(() => [dep(9, 'Production – app', 'main')], {
      9: () => [{ state: 'success', environment_url: 'https://app.com' }],
    })
    const r = await vercel.promoverProd(ctxDe({ github }) as never)
    expect(r.payload.deploymentId).toBe(9)
  })

  it('ignora Production de outro SHA', async () => {
    const github = githubFake(() => [dep(9, 'Production', 'main', undefined, 'outro')], {
      9: () => [{ state: 'success', environment_url: 'https://velho.com' }],
    })
    await expect(vercel.promoverProd(ctxDe({ github }) as never)).rejects.toThrow(
      /Nenhum deploy de Production/
    )
  })

  it('ignora Preview do mesmo SHA', async () => {
    const github = githubFake(() => [dep(1, 'Preview – app', 'develop')], {
      1: () => [{ state: 'success', environment_url: 'https://preview' }],
    })
    await expect(vercel.promoverProd(ctxDe({ github }) as never)).rejects.toThrow(
      /Nenhum deploy de Production para cafe123.*1 min/
    )
  })

  it('Production failure → erro em pt-BR com o estado', async () => {
    const github = githubFake(() => [dep(9, 'Production', 'main')], {
      9: () => [{ state: 'failure' }],
    })
    await expect(vercel.promoverProd(ctxDe({ github }) as never)).rejects.toThrow(
      `Deploy de Production falhou para ${SHA} (status: failure)`
    )
  })

  it('Production preso em in_progress → timeout com erro claro', async () => {
    const github = githubFake(() => [dep(9, 'Production', 'main')], {
      9: () => [{ state: 'in_progress' }],
    })
    await expect(vercel.promoverProd(ctxDe({ github }) as never)).rejects.toThrow(
      `Deploy de Production para ${SHA} não ficou pronto em 1 min`
    )
  })
})

describe('vercel: rollbackProd', () => {
  it('vercel rollback --yes --scope <team> com VERCEL_TOKEN só no env do exec', async () => {
    const ctx = ctxDe()
    await vercel.rollbackProd(ctx as never)
    expect(ctx.exec).toHaveBeenCalledWith('vercel', ['rollback', '--yes', '--scope', 'meu-time'], {
      env: { VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: 'team_org', VERCEL_PROJECT_ID: 'prj_app' },
    })
    const argv = JSON.stringify(ctx.exec.mock.calls.map((c: unknown[]) => [c[0], c[1]]))
    expect(argv).not.toContain(TOKEN)
    for (const c of ctx.log.mock.calls) expect(String(c)).not.toContain(TOKEN)
  })

  it('sem VERCEL_TOKEN → erro sem chamar o vercel', async () => {
    const ctx = ctxDe({ env: {} })
    await expect(vercel.rollbackProd(ctx as never)).rejects.toThrow(/VERCEL_TOKEN/)
    expect(ctx.exec).not.toHaveBeenCalled()
  })

  it.each(['VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'])(
    'sem %s → erro em pt-BR sem chamar o vercel',
    async (variavel) => {
      const env: Record<string, string> = {
        VERCEL_TOKEN: TOKEN,
        VERCEL_ORG_ID: 'team_org',
        VERCEL_PROJECT_ID: 'prj_app',
      }
      delete env[variavel]
      const ctx = ctxDe({ env })
      const erro = await vercel.rollbackProd(ctx as never).catch((e) => e)
      expect(String(erro.message)).toContain(`variável ${variavel} é obrigatória`)
      expect(String(erro.message)).not.toContain(TOKEN)
      expect(ctx.exec).not.toHaveBeenCalled()
    }
  )

  it('falha do vercel rollback → propaga sem o token', async () => {
    const exec = vi.fn(async () => {
      throw new Error("deploy: 'vercel' falhou: no previous deployment")
    })
    const erro = await vercel.rollbackProd(ctxDe({ exec }) as never).catch((e) => e)
    expect(String(erro.message)).toMatch(/no previous deployment/)
    expect(String(erro.message)).not.toContain(TOKEN)
  })
})
