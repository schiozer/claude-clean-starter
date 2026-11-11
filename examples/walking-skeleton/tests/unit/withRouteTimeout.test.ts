import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withRouteTimeout } from '@/shared/http/withRouteTimeout'

const SEGREDO = 's'.repeat(16)

const comAtraso = (ms: number) =>
  new Request('http://localhost/api/resources', {
    headers: { 'x-e2e-delay-ms': String(ms), 'x-e2e-secret': SEGREDO },
  })

describe('withRouteTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete process.env.APP_ENV
    delete process.env.E2E_FAULTS_SECRET
  })

  it('handler mais lento que ms → 504 TIMEOUT com mensagem genérica', async () => {
    const lento = () => new Promise<Response>((r) => setTimeout(() => r(new Response('ok')), 5000))
    const pending = withRouteTimeout(lento, 1000, 'api/teste:GET')(new Request('http://localhost/'))
    await vi.advanceTimersByTimeAsync(1000)
    const res = await pending
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({
      error: 'A operação demorou demais. Tente novamente.',
      code: 'TIMEOUT',
    })
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('handler rápido → resposta original intacta', async () => {
    const original = Response.json({ ok: true }, { status: 201 })
    const res = await withRouteTimeout(
      async () => original,
      1000,
      'api/teste:GET'
    )(new Request('http://localhost/'))
    expect(res).toBe(original)
  })

  it('com APP_ENV=production e header de atraso → sem atraso, mesma resposta', async () => {
    process.env.APP_ENV = 'production'
    process.env.E2E_FAULTS_SECRET = SEGREDO
    const original = new Response('ok')
    const handler = vi.fn(async () => original)
    const res = await withRouteTimeout(handler, 1000, 'api/teste:GET')(comAtraso(5000))
    expect(res).toBe(original)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('atraso injetado fora de Prod conta no prazo e não executa o handler após o 504', async () => {
    process.env.APP_ENV = 'uat'
    process.env.E2E_FAULTS_SECRET = SEGREDO
    const handler = vi.fn(async () => new Response('ok'))
    const pending = withRouteTimeout(handler, 1000, 'api/teste:POST')(comAtraso(5000))
    await vi.advanceTimersByTimeAsync(1000)
    expect((await pending).status).toBe(504)
    await vi.advanceTimersByTimeAsync(5000)
    expect(handler).not.toHaveBeenCalled()
  })

  it('handler que lança → erro tratado, nunca rejeita', async () => {
    const res = await withRouteTimeout(
      async () => {
        throw new Error('boom')
      },
      1000,
      'api/teste:GET'
    )(new Request('http://localhost/'))
    expect(res.status).toBe(500)
  })
})
