// CLI do AI-BOM: `npm run ai-bom` gera ai-bom.cdx.json; `-- --check` confere (CI).
// Subcomandos --env, --env-ci e --grafana entram nas próximas tarefas.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONFIG_PATH, parseAiObsConfig } from './ai-observabilidade/config.mjs'
import { coletar, gerarBom, serializar } from './ai-bom/inventario.mjs'

const ARQUIVO = 'ai-bom.cdx.json'
const USO = 'uso: ai-bom.mjs [--check]\n'

function lerConfig(deps) {
  const texto = deps.readFile(CONFIG_PATH)
  if (texto === null) return parseAiObsConfig(null)
  try {
    return parseAiObsConfig(JSON.parse(texto))
  } catch {
    // O inventário nunca depende de config válida: segue como desligado.
    return parseAiObsConfig(null)
  }
}

function gerarTexto(deps) {
  return serializar(gerarBom(coletar(deps), lerConfig(deps)))
}

function conferir(deps) {
  const atual = deps.readFile(ARQUIVO)
  if (atual === null) {
    deps.stderr(`ai-bom: ${ARQUIVO} não existe; rode npm run ai-bom para gerar.\n`)
    return 0
  }
  if (atual !== gerarTexto(deps)) {
    deps.stderr(`ai-bom: ${ARQUIVO} está desatualizado; rode npm run ai-bom e commite.\n`)
    return 1
  }
  deps.stdout(`ai-bom: ${ARQUIVO} em dia.\n`)
  return 0
}

/**
 * @param {string[]} argv
 * @param {{ cwd: string, readFile(p: string): string | null, writeFile(p: string, c: string): void,
 *   list(dir: string): string[], stdout(t: string): void, stderr(t: string): void }} deps
 * @returns {Promise<number>}
 */
export async function main(argv, deps) {
  if (argv.length === 0) {
    deps.writeFile(ARQUIVO, gerarTexto(deps))
    deps.stdout(`ai-bom: ${ARQUIVO} gerado.\n`)
    return 0
  }
  if (argv.length === 1 && argv[0] === '--check') return conferir(deps)
  deps.stderr(`ai-bom: argumento desconhecido (${argv.join(' ')}).\n${USO}`)
  return 2
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const cwd = process.cwd()
  const real = {
    cwd,
    readFile: (p) => (existsSync(join(cwd, p)) ? readFileSync(join(cwd, p), 'utf8') : null),
    writeFile: (p, c) => writeFileSync(join(cwd, p), c),
    list: (dir) => (existsSync(join(cwd, dir)) ? readdirSync(join(cwd, dir)) : []),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  }
  main(process.argv.slice(2), real).then(
    (codigo) => process.exit(codigo),
    (e) => {
      process.stderr.write(`ai-bom: erro — ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  )
}
