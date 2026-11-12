import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TimeoutError } from '@/shared/errors'
import { fetchWithTimeout } from '@/shared/http/fetchWithTimeout'

/** fetch que só responde quando `responder` é chamado, e rejeita ao abortar. */
const fetchPendente = () => {
  let responder: (res: Response) => void = () => {}
  const fake = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        responder = resolve
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        )
      })
  )
  return { fake, responder: (res: Response) => responder(res) }
}

describe('fetchWithTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejeita com TimeoutError após 15 000 ms', async () => {
    const { fake } = fetchPendente()
    vi.stubGlobal('fetch', fake)
    const pending = fetchWithTimeout('/api/resources')
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(fake.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
  })

  it('resolve antes do prazo', async () => {
    const { fake, responder } = fetchPendente()
    vi.stubGlobal('fetch', fake)
    const pending = fetchWithTimeout('/api/resources', { method: 'POST' })
    await vi.advanceTimersByTimeAsync(10_000)
    const res = new Response('ok')
    responder(res)
    expect(await pending).toBe(res)
    expect(fake.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('erro de rede antes do prazo propaga o erro original', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
    )
    await expect(fetchWithTimeout('/api/resources')).rejects.toBeInstanceOf(TypeError)
  })
})
