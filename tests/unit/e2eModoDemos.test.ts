import { describe, expect, it } from 'vitest'
import type { PlaywrightTestConfig } from '@playwright/test'
import { REPORTER_DEMOS, modoDemos } from '../e2e/support/modoDemos'

const base: PlaywrightTestConfig = {
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3100', video: 'retain-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm start', url: 'http://localhost:3100', reuseExistingServer: true },
}

describe('modoDemos', () => {
  it('fora de E2E_DEMOS=1 devolve a config intacta', () => {
    expect(modoDemos(base, {})).toBe(base)
    expect(modoDemos(base, { E2E_DEMOS: '0' })).toBe(base)
  })

  it('com E2E_DEMOS=1: vídeo sempre, câmera lenta, sem retentativa, reporter de demos, app novo', () => {
    const config = modoDemos(base, { E2E_DEMOS: '1' })
    expect(config.retries).toBe(0)
    expect(config.reporter).toEqual([['list'], [REPORTER_DEMOS]])
    expect(REPORTER_DEMOS).toMatch(/tests[\\/]e2e[\\/]support[\\/]demosReporter\.ts$/)
    expect(config.use).toEqual({
      baseURL: 'http://localhost:3100',
      video: 'on',
      trace: 'retain-on-failure',
      launchOptions: { slowMo: 500 },
    })
    expect(config.webServer).toEqual({
      command: 'npm start',
      url: 'http://localhost:3100',
      reuseExistingServer: false,
    })
    expect(base.retries).toBe(1)
  })

  it('preserva launchOptions do projeto e aceita webServer em lista ou ausente', () => {
    const lista = modoDemos(
      {
        use: { launchOptions: { headless: true } },
        webServer: [
          { command: 'a', reuseExistingServer: true },
          { command: 'b', reuseExistingServer: true },
        ],
      },
      { E2E_DEMOS: '1' }
    )
    expect(lista.use?.launchOptions).toEqual({ headless: true, slowMo: 500 })
    expect(lista.webServer).toEqual([
      { command: 'a', reuseExistingServer: false },
      { command: 'b', reuseExistingServer: false },
    ])
    expect(modoDemos({} as PlaywrightTestConfig, { E2E_DEMOS: '1' }).webServer).toBeUndefined()
  })
})
