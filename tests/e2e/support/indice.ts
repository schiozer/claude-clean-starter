// Índice de cenários e RNF lido em tempo de execução pelos helpers (mesmo `loadIndice` do
// `check-cenarios`). `E2E_CENARIOS_CONFIG` troca o arquivo de config (selftests com índice falso).
import { fileURLToPath } from 'node:url'
import { CONFIG_PATH, loadIndice } from '../../../scripts/e2e/config.mjs'

export type Indice = ReturnType<typeof loadIndice>
export type Cenario = Indice['cenarios'] extends Map<string, infer C> ? C : never

/** Raiz do repositório: `tests/e2e/support/` fica três níveis abaixo. */
export const RAIZ = fileURLToPath(new URL('../../../', import.meta.url))

const cache = new Map<string, Indice>()

/** Índice da config ativa, lido uma vez por worker e por arquivo de config. */
export const indiceAtual = (): Indice => {
  const configPath = process.env.E2E_CENARIOS_CONFIG?.trim() || CONFIG_PATH
  let indice = cache.get(configPath)
  if (!indice) {
    indice = loadIndice(RAIZ, { configPath })
    cache.set(configPath, indice)
  }
  return indice
}
