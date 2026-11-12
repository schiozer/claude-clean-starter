// Modo demos do Playwright (`npm run demos:gravar`, `E2E_DEMOS=1`), gerenciado pelo template. O
// `playwright.config.ts` do projeto envolve a config: `defineConfig(modoDemos({ ... }))`. Sem ele o
// reporter não grava `.e2e/demos/manifesto.json` e o `demos:publicar` falha (ADR-017).
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PlaywrightTestConfig } from '@playwright/test'

/** Caminho absoluto do reporter que escreve `.e2e/demos/manifesto.json`. */
export const REPORTER_DEMOS = join(dirname(fileURLToPath(import.meta.url)), 'demosReporter.ts')

const CAMERA_LENTA_MS = 500

type WebServer = NonNullable<PlaywrightTestConfig['webServer']>
type UmWebServer = WebServer extends (infer U)[] ? U : WebServer

const appNovo = (servidor: UmWebServer): UmWebServer => ({
  ...servidor,
  reuseExistingServer: false,
})

/**
 * Fora de `E2E_DEMOS=1` devolve a config intacta. Com ele: vídeo de todo teste, em câmera lenta,
 * sem retentativa, com o reporter de demos e sempre contra um app novo (nunca reaproveita servidor).
 */
export function modoDemos<T extends PlaywrightTestConfig>(
  config: T,
  env: Record<string, string | undefined> = process.env
): T {
  if (env.E2E_DEMOS !== '1') return config
  const { webServer } = config
  return {
    ...config,
    retries: 0,
    reporter: [['list'], [REPORTER_DEMOS]],
    use: {
      ...config.use,
      video: 'on',
      launchOptions: { ...config.use?.launchOptions, slowMo: CAMERA_LENTA_MS },
    },
    webServer: Array.isArray(webServer)
      ? webServer.map(appNovo)
      : webServer
        ? appNovo(webServer)
        : undefined,
  }
}
