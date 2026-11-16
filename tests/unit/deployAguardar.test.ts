import { describe, it, expect, vi } from 'vitest'
import { waitPreview } from '../../scripts/deploy/aguardar.mjs'

const SHA = 'abc1234def'

const makeApi = () => ({
  call: vi.fn(async (_method: string, path: string) => {
    if (/^\/deployments\/\d+\/statuses/.test(path)) {
      return [{ state: 'success', environment_url: 'https://app-pr-12.example.com' }]
    }
    return [
      { id: 1, environment: 'Preview', created_at: '2026-11-10T10:00:00Z' },
      { id: 2, environment: 'app-pr-12', created_at: '2026-11-10T09:00:00Z' },
    ]
  }),
})

const makeClock = () => {
  const clock = { t: 0 }
  const sleep = vi.fn(async (ms: number) => {
    clock.t += ms
  })
  return { now: () => clock.t, sleep }
}

describe('waitPreview (genérico)', () => {
  it('usa o predicado ambienteDePreview e devolve a URL do deploy que casa', async () => {
    const { now, sleep } = makeClock()
    const api = makeApi()
    const result = await waitPreview({
      api,
      sha: SHA,
      ambienteDePreview: (e: string) => e === 'app-pr-12',
      now,
      sleep,
    })
    expect(result).toEqual({ url: 'https://app-pr-12.example.com' })
    expect(api.call).toHaveBeenCalledWith('GET', '/deployments/2/statuses?per_page=1')
  })

  it('ignora deployment que não casa até o timeout', async () => {
    const { now, sleep } = makeClock()
    await expect(
      waitPreview({
        api: makeApi(),
        sha: SHA,
        ambienteDePreview: (e: string) => e === 'outro',
        timeoutMs: 30_000,
        intervalMs: 10_000,
        now,
        sleep,
      })
    ).rejects.toThrow(`Nenhum deploy de preview para ${SHA}`)
  })
})
