import { describe, it, expect } from 'vitest'
import { makeBunnyStreamVideoHost, makeFakeVideoHost } from '../../scripts/demos/video-host.mjs'

describe('makeFakeVideoHost', () => {
  it('ensureCollection é idempotente por nome', async () => {
    const host = makeFakeVideoHost()
    const a = await host.ensureCollection('v1.2.0')
    const b = await host.ensureCollection('v1.2.0')
    expect(b.id).toBe(a.id)
    expect(host.ops).toEqual(['ensure:v1.2.0', 'create:v1.2.0', 'ensure:v1.2.0'])
  })

  it('upload com o mesmo título faz upsert', async () => {
    const host = makeFakeVideoHost()
    const { id } = await host.ensureCollection('v1.2.0')
    await host.upload({ colecao: id, titulo: 'a', arquivo: 'a.webm' })
    const second = await host.upload({ colecao: id, titulo: 'a', arquivo: 'a.webm' })
    const videos = host.colecoes.get(id)!.videos
    expect([...videos.keys()]).toEqual([second.videoId])
  })

  it('replaceCollection troca a coleção só depois do preenchimento', async () => {
    const host = makeFakeVideoHost()
    const old = await host.ensureCollection('Treinamento')
    await host.upload({ colecao: old.id, titulo: 'x', arquivo: 'x' })
    await host.upload({ colecao: old.id, titulo: 'y', arquivo: 'y' })
    host.ops.length = 0

    let novaId = ''
    await host.replaceCollection('Treinamento', async (id) => {
      novaId = id
      await host.upload({ colecao: id, titulo: 'z', arquivo: 'z' })
    })

    expect(novaId).not.toBe(old.id)
    expect([...host.colecoes.keys()]).toEqual([novaId])
    expect(host.ops).toEqual([
      'create:Treinamento',
      'upload:Treinamento:z',
      'delete-video:x',
      'delete-video:y',
      'delete-collection:Treinamento',
    ])
  })

  it('replaceCollection preserva a antiga se preencher lançar', async () => {
    const host = makeFakeVideoHost()
    const old = await host.ensureCollection('Treinamento')
    await host.upload({ colecao: old.id, titulo: 'x', arquivo: 'x' })
    await host.upload({ colecao: old.id, titulo: 'y', arquivo: 'y' })

    await expect(
      host.replaceCollection('Treinamento', async (id) => {
        await host.upload({ colecao: id, titulo: 'z', arquivo: 'z' })
        throw new Error('x')
      })
    ).rejects.toThrow('x')

    expect([...host.colecoes.keys()]).toEqual([old.id])
    expect(host.colecoes.get(old.id)!.videos.size).toBe(2)
  })

  it('embedUrl usa o libraryId', () => {
    expect(makeFakeVideoHost({ libraryId: '7' }).embedUrl('abc')).toBe(
      'https://iframe.mediadelivery.net/embed/7/abc'
    )
  })
})

type Call = { method: string; url: string; headers: Record<string, string>; body?: unknown }

const makeFetch = (respond: (call: Call) => { status?: number; json?: unknown }) => {
  const calls: Call[] = []
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      headers: init.headers as Record<string, string>,
      body: init.body,
    }
    calls.push(call)
    const { status = 200, json = {} } = respond(call)
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(json),
      json: async () => json,
    }
  }
  return { calls, fetchFn: fetchFn as unknown as typeof fetch }
}

const BASE = 'https://video.bunnycdn.com/library/123'
const readFile = async () => Buffer.from('bytes')

describe('makeBunnyStreamVideoHost', () => {
  it('ensureCollection escolhe o nome exato', async () => {
    const { calls, fetchFn } = makeFetch(() => ({
      json: {
        items: [
          { guid: 'g-rc', name: 'v1.2.0-rc' },
          { guid: 'g-ok', name: 'v1.2.0' },
        ],
      },
    }))
    const host = makeBunnyStreamVideoHost({ apiKey: 'k', libraryId: '123', fetchFn, readFile })
    expect(await host.ensureCollection('v1.2.0')).toEqual({ id: 'g-ok' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/collections?search=v1.2.0&itemsPerPage=100`)
  })

  it('ensureCollection cria quando não há nome exato', async () => {
    const { calls, fetchFn } = makeFetch((c) =>
      c.method === 'POST'
        ? { json: { guid: 'novo' } }
        : { json: { items: [{ guid: 'g-rc', name: 'v1.2.0-rc' }] } }
    )
    const host = makeBunnyStreamVideoHost({ apiKey: 'k', libraryId: '123', fetchFn, readFile })
    expect(await host.ensureCollection('v1.2.0')).toEqual({ id: 'novo' })
    expect(calls[1].method).toBe('POST')
    expect(calls[1].url).toBe(`${BASE}/collections`)
    expect(JSON.parse(calls[1].body as string)).toEqual({ name: 'v1.2.0' })
  })

  it('upload cria, envia os bytes e só então apaga o antigo de mesmo título', async () => {
    const { calls, fetchFn } = makeFetch((c) => {
      if (c.method === 'POST') return { json: { guid: 'novo' } }
      if (c.method === 'GET') {
        return {
          json: {
            items: [
              { guid: 'velho', title: 'a' },
              { guid: 'novo', title: 'a' },
              { guid: 'outro', title: 'a b' },
            ],
          },
        }
      }
      return {}
    })
    const host = makeBunnyStreamVideoHost({ apiKey: 'k', libraryId: '123', fetchFn, readFile })
    expect(await host.upload({ colecao: 'c1', titulo: 'a', arquivo: 'a.webm' })).toEqual({
      videoId: 'novo',
    })
    const seq = calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)
    expect(seq[0]).toBe('POST /videos')
    expect(JSON.parse(calls[0].body as string)).toEqual({ title: 'a', collectionId: 'c1' })
    expect(seq[1]).toBe('PUT /videos/novo')
    expect(calls[1].headers['content-type']).toBe('application/octet-stream')
    expect(Buffer.from(calls[1].body as Buffer).toString()).toBe('bytes')
    expect(seq.slice(2)).toEqual([
      'GET /videos?collection=c1&search=a&itemsPerPage=100',
      'DELETE /videos/velho',
    ])
  })

  it('replaceCollection apaga a nova se preencher lançar', async () => {
    const { calls, fetchFn } = makeFetch((c) => {
      if (c.method === 'POST') return { json: { guid: 'nova' } }
      if (c.method === 'GET' && c.url.includes('/collections')) {
        return { json: { items: [{ guid: 'velha', name: 'Treinamento' }] } }
      }
      return { json: { items: [] } }
    })
    const host = makeBunnyStreamVideoHost({ apiKey: 'k', libraryId: '123', fetchFn, readFile })
    await expect(
      host.replaceCollection('Treinamento', async () => {
        throw new Error('x')
      })
    ).rejects.toThrow('x')
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url.replace(BASE, ''))
    expect(deletes).toEqual(['/collections/nova'])
  })

  it('replaceCollection apaga vídeos e coleção antigos após o sucesso', async () => {
    const { calls, fetchFn } = makeFetch((c) => {
      if (c.method === 'POST') return { json: { guid: 'nova' } }
      if (c.url.includes('/collections?')) {
        return { json: { items: [{ guid: 'velha', name: 'Treinamento' }] } }
      }
      return { json: { items: [{ guid: 'v1', title: 'x' }] } }
    })
    const host = makeBunnyStreamVideoHost({ apiKey: 'k', libraryId: '123', fetchFn, readFile })
    expect(await host.replaceCollection('Treinamento', async () => 42)).toBe(42)
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url.replace(BASE, ''))
    expect(deletes).toEqual(['/videos/v1', '/collections/velha'])
  })

  it('manda AccessKey e não vaza a chave no erro', async () => {
    const apiKey = 'segredo-123'
    const { calls, fetchFn } = makeFetch(() => ({ status: 401 }))
    const host = makeBunnyStreamVideoHost({ apiKey, libraryId: '123', fetchFn, readFile })
    const error = await host.ensureCollection('v1').catch((e: Error) => e)
    expect(calls[0].headers.AccessKey).toBe(apiKey)
    expect((error as Error).message).toMatch(
      /^bunny-stream: GET \/library\/\d+\/collections.* → 401$/
    )
    expect((error as Error).message).not.toContain(apiKey)
  })

  it('embedUrl usa o libraryId', () => {
    const host = makeBunnyStreamVideoHost({ apiKey: 'k', libraryId: '123', readFile })
    expect(host.embedUrl('abc')).toBe('https://iframe.mediadelivery.net/embed/123/abc')
  })
})
