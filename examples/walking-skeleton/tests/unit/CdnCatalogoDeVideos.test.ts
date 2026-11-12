import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CdnCatalogoDeVideos } from '@/modules/ajuda/infrastructure/CdnCatalogoDeVideos'
import type { Clock } from '@/shared/kernel'

const INDICE = {
  formato: 1,
  atualizadoEm: '2026-11-12T00:00:00.000Z',
  libraryId: 'lib',
  versoes: ['v1.0.0'],
  demos: {},
  treinamento: null,
}

const resposta = (corpo: string, status = 200) => new Response(corpo, { status })

class RelogioFalso implements Clock {
  constructor(public ms = 1_000_000) {}
  now(): Date {
    return new Date(this.ms)
  }
}

describe('CdnCatalogoDeVideos', () => {
  let clock: RelogioFalso
  let erro: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clock = new RelogioFalso()
    erro = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    erro.mockRestore()
  })

  it('200 com índice válido → objeto; 2ª chamada dentro do TTL não refaz o fetch', async () => {
    const fetchFn = vi.fn(async () => resposta(JSON.stringify(INDICE)))
    const cdn = new CdnCatalogoDeVideos({ url: 'https://cdn/x.json', fetchFn, clock })
    expect(await cdn.indice()).toEqual(INDICE)
    clock.ms += 299_999
    expect(await cdn.indice()).toEqual(INDICE)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('500 sem cache → null e loga em ajuda:catalogo', async () => {
    const fetchFn = vi.fn(async () => resposta('x', 500))
    const cdn = new CdnCatalogoDeVideos({ url: 'https://cdn/x.json', fetchFn, clock })
    expect(await cdn.indice()).toBeNull()
    expect(erro).toHaveBeenCalledWith('[ajuda:catalogo]', expect.anything())
  })

  it('expirado e o refetch falha → null (cache vencido não é servido)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resposta(JSON.stringify(INDICE)))
      .mockResolvedValueOnce(resposta('x', 500))
    const cdn = new CdnCatalogoDeVideos({ url: 'https://cdn/x.json', fetchFn, clock })
    await cdn.indice()
    clock.ms += 300_001
    expect(await cdn.indice()).toBeNull()
  })

  it('refetch forçado que falha dentro do TTL → cache', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resposta(JSON.stringify(INDICE)))
      .mockRejectedValueOnce(new Error('rede'))
    const cdn = new CdnCatalogoDeVideos({ url: 'https://cdn/x.json', fetchFn, clock })
    await cdn.indice()
    expect(await cdn.indice({ forcar: true })).toEqual(INDICE)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('formato desconhecido → null', async () => {
    const fetchFn = vi.fn(async () => resposta('{"formato":2}'))
    const cdn = new CdnCatalogoDeVideos({ url: 'https://cdn/x.json', fetchFn, clock })
    expect(await cdn.indice()).toBeNull()
  })

  it('JSON corrompido → null, sem lançar', async () => {
    const fetchFn = vi.fn(async () => resposta('{nao e json'))
    const cdn = new CdnCatalogoDeVideos({ url: 'https://cdn/x.json', fetchFn, clock })
    expect(await cdn.indice()).toBeNull()
  })

  it('fetch que nunca resolve → null em até 3000 ms', async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, rejeita) => {
          init?.signal?.addEventListener('abort', () => rejeita(new Error('abortado')))
        })
    )
    const cdn = new CdnCatalogoDeVideos({ url: 'https://cdn/x.json', fetchFn, clock })
    const p = cdn.indice()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await p).toBeNull()
  })

  it('fetch que ignora o abort também termina em até 3000 ms', async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn(() => new Promise<Response>(() => undefined))
    const cdn = new CdnCatalogoDeVideos({ url: 'https://cdn/x.json', fetchFn, clock })
    const p = cdn.indice()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await p).toBeNull()
  })
})
