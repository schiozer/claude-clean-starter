import { describe, it, expect, vi } from 'vitest'
import { makeGithubClient } from '../../scripts/github-api.mjs'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const makeClient = (handler: (url: string) => Response) => {
  const fetchFn = vi.fn(async (url: string) => handler(url))
  const client = makeGithubClient({
    token: 'tok',
    repository: 'o/r',
    apiUrl: 'https://gh.test',
    fetchFn,
    userAgent: 'teste',
  } as never)
  return { client, fetchFn }
}

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))

describe('makeGithubClient', () => {
  it('envia headers e devolve JSON', async () => {
    const { client, fetchFn } = makeClient(() => json({ a: 1 }))
    expect(await client.call('GET', '/x')).toEqual({ a: 1 })
    expect(fetchFn.mock.calls[0][0]).toBe('https://gh.test/repos/o/r/x')
    expect((fetchFn.mock.calls[0] as unknown[])[1]).toMatchObject({
      headers: { Authorization: 'Bearer tok', 'User-Agent': 'teste' },
    })
  })

  it('204 e corpo vazio devolvem null', async () => {
    const { client } = makeClient(() => new Response(null, { status: 204 }))
    expect(await client.call('DELETE', '/x')).toBeNull()
    const empty = makeClient(() => new Response('', { status: 200 }))
    expect(await empty.client.call('GET', '/x')).toBeNull()
  })

  it('erro 404 rejeita com status e path na mensagem', async () => {
    const { client } = makeClient(() => json({}, 404))
    await expect(client.call('GET', '/commits/abc')).rejects.toThrow(/GET \/commits\/abc.*404/)
  })

  it('paginate segue páginas até uma com menos de 100 itens', async () => {
    const { client, fetchFn } = makeClient((url) =>
      json(url.endsWith('page=1') ? items(100) : items(30))
    )
    expect(await client.paginate('/things')).toHaveLength(130)
    expect(fetchFn.mock.calls.map(([u]) => u)).toEqual([
      'https://gh.test/repos/o/r/things?per_page=100&page=1',
      'https://gh.test/repos/o/r/things?per_page=100&page=2',
    ])
  })

  it('paginate usa & quando o path já tem query e aplica pick', async () => {
    const { client, fetchFn } = makeClient(() => json({ check_runs: items(2) }))
    const result = await client.paginate(
      '/runs?filter=latest',
      (page) => (page as never as { check_runs: unknown[] }).check_runs
    )
    expect(result).toHaveLength(2)
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://gh.test/repos/o/r/runs?filter=latest&per_page=100&page=1'
    )
  })
})
