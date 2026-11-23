import { describe, it, expect, vi } from 'vitest'
import { marcar, registrar, ultimoOk } from '../../scripts/deploy/githubDeployments.mjs'

const SHA = 'abc1234def5678'

type Rota = (method: string, path: string, body?: unknown) => unknown
const cliente = (rota: Rota) => ({
  call: vi.fn(async (m: string, p: string, b?: unknown) => rota(m, p, b)),
})

describe('registrar', () => {
  it('cria o Deployment do SHA e marca success com a URL; devolve o id', async () => {
    const github = cliente((m, p) => (p === '/deployments' ? { id: 42 } : { id: 1 }))
    const id = await registrar(github, {
      sha: SHA,
      ambiente: 'uat',
      url: 'https://app-uat.herokuapp.com/',
      payload: { slug: 'slug-1' },
    })
    expect(id).toBe(42)
    expect(github.call).toHaveBeenNthCalledWith(1, 'POST', '/deployments', {
      ref: SHA,
      environment: 'uat',
      payload: { sha: SHA, slug: 'slug-1' },
      auto_merge: false,
      required_contexts: [],
    })
    expect(github.call).toHaveBeenNthCalledWith(2, 'POST', '/deployments/42/statuses', {
      state: 'success',
      environment_url: 'https://app-uat.herokuapp.com/',
    })
  })
})

describe('marcar', () => {
  it('posta o estado com URL', async () => {
    const github = cliente(() => ({}))
    await marcar(github, 7, 'failure', 'https://x.example')
    expect(github.call).toHaveBeenCalledWith('POST', '/deployments/7/statuses', {
      state: 'failure',
      environment_url: 'https://x.example',
    })
  })

  it('sem URL não envia environment_url', async () => {
    const github = cliente(() => ({}))
    await marcar(github, 7, 'in_progress')
    expect(github.call).toHaveBeenCalledWith('POST', '/deployments/7/statuses', {
      state: 'in_progress',
    })
  })
})

describe('ultimoOk', () => {
  const deployments = [
    { id: 3, sha: 'c3', created_at: '2026-11-23T12:00:00Z', payload: { sha: 'c3', slug: 's3' } },
    { id: 2, sha: 'c2', created_at: '2026-11-23T11:00:00Z', payload: { sha: 'c2', slug: 's2' } },
    { id: 1, sha: 'c1', created_at: '2026-11-23T10:00:00Z', payload: { sha: 'c1', slug: 's1' } },
  ]
  const statuses: Record<number, unknown[]> = {
    3: [{ state: 'failure' }],
    2: [{ state: 'success', environment_url: 'https://u2.example' }],
    1: [{ state: 'success', environment_url: 'https://u1.example' }],
  }
  const rota: Rota = (_m, p) => {
    if (p.startsWith('/deployments?')) return deployments
    const id = Number(p.split('/')[2])
    return statuses[id]
  }

  it('pula failure e devolve o mais novo com status success', async () => {
    const github = cliente(rota)
    expect(await ultimoOk(github, 'uat')).toEqual({
      sha: 'c2',
      payload: { sha: 'c2', slug: 's2' },
      url: 'https://u2.example',
    })
    expect(github.call.mock.calls[0][1]).toBe('/deployments?environment=uat&per_page=100')
    expect(github.call.mock.calls[1][1]).toBe('/deployments/3/statuses?per_page=1')
  })

  it('não confia na ordem da API: ordena do mais novo para o mais antigo', async () => {
    const github = cliente((m, p) =>
      p.startsWith('/deployments?') ? [...deployments].reverse() : rota(m, p)
    )
    expect((await ultimoOk(github, 'production'))?.sha).toBe('c2')
  })

  it('ignora error e sem status; sem nenhum success → null', async () => {
    const github = cliente((_m, p) => {
      if (p.startsWith('/deployments?')) return deployments
      return p.includes('/3/') ? [{ state: 'error' }] : []
    })
    expect(await ultimoOk(github, 'uat')).toBeNull()
  })

  it('payload em texto JSON é aceito; sha vem do payload', async () => {
    const github = cliente((_m, p) =>
      p.startsWith('/deployments?')
        ? [
            {
              id: 9,
              sha: 'ref',
              created_at: 'x',
              payload: JSON.stringify({ sha: 'p9', digest: 'd' }),
            },
          ]
        : [{ state: 'success', environment_url: 'https://u9.example' }]
    )
    expect(await ultimoOk(github, 'uat')).toEqual({
      sha: 'p9',
      payload: { sha: 'p9', digest: 'd' },
      url: 'https://u9.example',
    })
  })
})
