import { describe, it, expect, vi } from 'vitest'
import { waitPreview } from '../../scripts/e2e/wait-preview.mjs'

const SHA = 'abc1234def'
const STATUSES = /^\/deployments\/(\d+)\/statuses/

type Deploy = { id: number; environment: string; created_at: string }
type Status = { state: string; environment_url?: string; target_url?: string }

/** `api` falso: `deployments(t)` e `statuses(id, t)` respondem conforme o instante simulado. */
const makeApi = (
  deployments: (t: number) => Deploy[],
  statuses: (id: number, t: number) => Status[],
  clock: { t: number }
) => {
  const call = vi.fn(async (method: string, path: string) => {
    expect(method).toBe('GET')
    const status = path.match(STATUSES)
    if (status) return statuses(Number(status[1]), clock.t)
    expect(path).toContain(`/deployments?sha=${SHA}`)
    return deployments(clock.t)
  })
  return { call }
}

const httpErro = (status: number) =>
  Object.assign(new Error(`GitHub API GET /deployments falhou: HTTP ${status}`), { status })

/** Relógio falso: `sleep` só avança o tempo, nunca espera de verdade. */
const makeClock = () => {
  const clock = { t: 0 }
  const sleep = vi.fn(async (ms: number) => {
    clock.t += ms
  })
  return { clock, now: () => clock.t, sleep }
}

const preview = (id: number, created_at = '2026-11-10T10:00:00Z'): Deploy => ({
  id,
  environment: 'Preview',
  created_at,
})

describe('waitPreview', () => {
  it('success → devolve environment_url', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      () => [preview(1)],
      () => [{ state: 'success', environment_url: 'https://app-git-x.vercel.app' }],
      clock
    )
    await expect(waitPreview({ api, sha: SHA, now, sleep })).resolves.toEqual({
      url: 'https://app-git-x.vercel.app',
    })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('success sem environment_url → usa target_url', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      () => [preview(1)],
      () => [{ state: 'success', target_url: 'https://t.vercel.app' }],
      clock
    )
    expect(await waitPreview({ api, sha: SHA, now, sleep })).toEqual({
      url: 'https://t.vercel.app',
    })
  })

  it('espera enquanto pending e devolve quando fica success', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      (t) => (t < 30_000 ? [] : [preview(1)]),
      (_id, t) =>
        t < 60_000
          ? [{ state: 'in_progress' }]
          : [{ state: 'success', environment_url: 'https://ok.vercel.app' }, { state: 'pending' }],
      clock
    )
    expect(await waitPreview({ api, sha: SHA, now, sleep })).toEqual({
      url: 'https://ok.vercel.app',
    })
    expect(sleep).toHaveBeenCalledWith(15_000)
    expect(clock.t).toBe(60_000)
  })

  it('failure ou error → lança "Deploy de preview falhou"', async () => {
    for (const state of ['failure', 'error']) {
      const { clock, now, sleep } = makeClock()
      const api = makeApi(
        () => [preview(1)],
        () => [{ state }],
        clock
      )
      await expect(waitPreview({ api, sha: SHA, now, sleep })).rejects.toThrow(
        /Deploy de preview falhou/
      )
    }
  })

  it('nunca aparece → lança após 900 000 ms simulados', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      () => [],
      () => [],
      clock
    )
    await expect(waitPreview({ api, sha: SHA, now, sleep })).rejects.toThrow(
      `Nenhum deploy de preview para ${SHA} em 15 min`
    )
    expect(clock.t).toBeGreaterThanOrEqual(900_000)
    expect(clock.t).toBeLessThan(900_000 + 15_000)
  })

  it('deploy que não fica pronto até o timeout → erro de timeout', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      () => [preview(1)],
      () => [{ state: 'pending' }],
      clock
    )
    await expect(
      waitPreview({ api, sha: SHA, now, sleep, timeoutMs: 60_000, intervalMs: 10_000 })
    ).rejects.toThrow(/não ficou pronto em 1 min/)
    expect(clock.t).toBe(60_000)
  })

  it('ignora environment Production', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      () => [{ id: 9, environment: 'Production', created_at: '2026-11-10T11:00:00Z' }],
      () => [{ state: 'success', environment_url: 'https://prod.example.com' }],
      clock
    )
    await expect(
      waitPreview({ api, sha: SHA, now, sleep, timeoutMs: 30_000, intervalMs: 15_000 })
    ).rejects.toThrow(/Nenhum deploy de preview/)
  })

  it('aceita "Preview – projeto" e usa o deploy mais recente quando há dois', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      () => [
        preview(1, '2026-11-10T10:00:00Z'),
        { id: 2, environment: 'Preview – app', created_at: '2026-11-10T10:05:00Z' },
      ],
      (id) =>
        id === 2
          ? [{ state: 'success', environment_url: 'https://novo.vercel.app' }]
          : [{ state: 'failure' }],
      clock
    )
    expect(await waitPreview({ api, sha: SHA, now, sleep })).toEqual({
      url: 'https://novo.vercel.app',
    })
  })

  it('success sem environment_url nem target_url → lança "Deploy de preview sem URL" na hora', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      () => [preview(1)],
      () => [{ state: 'success' }],
      clock
    )
    await expect(waitPreview({ api, sha: SHA, now, sleep })).rejects.toThrow(
      /Deploy de preview sem URL/
    )
    expect(sleep).not.toHaveBeenCalled()
  })

  it('5xx e 403/429 da API → tenta no próximo ciclo e devolve quando responde', async () => {
    for (const status of [500, 502, 403, 429]) {
      const { clock, now, sleep } = makeClock()
      const api = makeApi(
        (t) => {
          if (t < 30_000) throw httpErro(status)
          return [preview(1)]
        },
        () => [{ state: 'success', environment_url: 'https://ok.vercel.app' }],
        clock
      )
      expect(await waitPreview({ api, sha: SHA, now, sleep })).toEqual({
        url: 'https://ok.vercel.app',
      })
      expect(clock.t).toBe(30_000)
    }
  })

  it('erro transitório até o prazo → timeout com o último erro', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      () => {
        throw httpErro(503)
      },
      () => [],
      clock
    )
    await expect(
      waitPreview({ api, sha: SHA, now, sleep, timeoutMs: 60_000, intervalMs: 15_000 })
    ).rejects.toThrow(/Nenhum deploy de preview .* em 1 min .*HTTP 503/)
  })

  it('outros erros HTTP (404) não são tentados de novo', async () => {
    const { clock, now, sleep } = makeClock()
    const api = makeApi(
      () => {
        throw httpErro(404)
      },
      () => [],
      clock
    )
    await expect(waitPreview({ api, sha: SHA, now, sleep })).rejects.toThrow(/HTTP 404/)
    expect(sleep).not.toHaveBeenCalled()
  })
})
