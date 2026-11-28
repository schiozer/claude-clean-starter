// CLI do AI-BOM: `npm run ai-bom` gera ai-bom.cdx.json; `-- --check` confere (CI).
// `-- --env` imprime os exports de telemetria da sessão local; `--env-ci` imprime NAME=VALUE para $GITHUB_ENV. `-- --grafana` imprime as regras de alerta do teto (só o hub).

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONFIG_PATH, papel, parseAiObsConfig } from './ai-observabilidade/config.mjs'
import { regrasAlerta } from './ai-observabilidade/grafana.mjs'
import { envTelemetria, otlpResolvido, referenciasOtlp } from './ai-observabilidade/metricas.mjs'
import { coletar, gerarBom, serializar } from './ai-bom/inventario.mjs'

const ARQUIVO = 'ai-bom.cdx.json'
const USO = 'uso: ai-bom.mjs [--check | --env | --env-ci | --grafana]\n'

// Config ausente = desligado; presente e inválida = erro (CT-AIBOM-005).
function lerConfig(deps) {
  const texto = deps.readFile(CONFIG_PATH)
  if (texto === null) return parseAiObsConfig(null)
  let json
  try {
    json = JSON.parse(texto)
  } catch (e) {
    throw new Error(`${CONFIG_PATH}: JSON inválido (${e.message})`)
  }
  return parseAiObsConfig(json)
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

// Valores com ${...} saem entre aspas: o shell expande a referência sem separar palavras.
const aspas = (valor) => (valor.startsWith('${') ? `"${valor}"` : valor)

// Endpoint e headers saem como referências literais: o segredo nunca é resolvido nem impresso.
function imprimirEnv(deps) {
  const cfg = lerConfig(deps)
  if (papel(cfg) === 'desligado') {
    deps.stderr(
      'ai-bom: observabilidade desligada (ativo:false ou config ausente); nada a exportar.\n'
    )
    return 0
  }
  const variaveis = { ...envTelemetria(cfg.projeto, 'local'), ...referenciasOtlp() }
  const linhas = Object.entries(variaveis).map(([nome, valor]) => `export ${nome}=${aspas(valor)}`)
  deps.stdout(`${linhas.join('\n')}\n`)
  return 0
}

// CI: NAME=VALUE sem export (formato do $GITHUB_ENV, que não expande ${}); endpoint e headers vêm
// já resolvidos do env do passo. Faltando algum, nada é impresso (fail-open).
function imprimirEnvCi(deps) {
  let cfg
  try {
    cfg = lerConfig(deps)
  } catch (e) {
    deps.stderr(`ai-bom: config inválida (${e.message}); telemetria do CI não ligada.\n`)
    return 0
  }
  if (papel(cfg) === 'desligado') {
    deps.stderr(
      'ai-bom: observabilidade desligada (ativo:false ou config ausente); nada a exportar.\n'
    )
    return 0
  }
  const { valores, faltando } = otlpResolvido(deps.env ?? {})
  if (!valores) {
    deps.stderr(
      `ai-bom: segredo do coletor ausente (${faltando.join(', ')}); telemetria do CI não ligada.\n`
    )
    return 0
  }
  const variaveis = { ...envTelemetria(cfg.projeto, 'ci'), ...valores }
  // $GITHUB_ENV é uma linha por variável: quebra de linha em qualquer valor injetaria variáveis
  // nos passos seguintes (a config vem do head do PR). Vírgula/igual quebrariam o resource attribute.
  if (Object.values(variaveis).some((v) => /[\r\n]/.test(v))) {
    deps.stderr(
      'ai-bom: valor inválido para o CI (quebra de linha); telemetria do CI não ligada.\n'
    )
    return 0
  }
  deps.stdout(
    `${Object.entries(variaveis)
      .map(([n, v]) => `${n}=${v}`)
      .join('\n')}\n`
  )
  return 0
}

// Só o hub (central: true) gera alertas; emissor e desligado saem 0 sem stdout (CT-AIBOM-006).
function imprimirGrafana(deps) {
  const cfg = lerConfig(deps)
  if (papel(cfg) !== 'hub') {
    deps.stderr('ai-bom: só o hub (central: true) gera alertas; nada a gerar aqui.\n')
    return 0
  }
  deps.stdout(`${JSON.stringify(regrasAlerta(cfg), null, 2)}\n`)
  return 0
}

/**
 * @param {string[]} argv
 * @param {{ cwd: string, readFile(p: string): string | null, writeFile(p: string, c: string): void,
 *   list(dir: string): string[], stdout(t: string): void, stderr(t: string): void }} deps
 * @returns {Promise<number>}
 */
export async function main(argv, deps) {
  try {
    return await executar(argv, deps)
  } catch (e) {
    deps.stderr(`ai-bom: ${e instanceof Error ? e.message : String(e)}\n`)
    return 1
  }
}

async function executar(argv, deps) {
  // Qualquer comando falha com config inválida, menos --env-ci (fail-open: não derruba o gate).
  if (argv[0] !== '--env-ci') lerConfig(deps)
  if (argv.length === 0) {
    deps.writeFile(ARQUIVO, gerarTexto(deps))
    deps.stdout(`ai-bom: ${ARQUIVO} gerado.\n`)
    return 0
  }
  if (argv.length === 1 && argv[0] === '--check') return conferir(deps)
  if (argv.length === 1 && argv[0] === '--env') return imprimirEnv(deps)
  if (argv.length === 1 && argv[0] === '--env-ci') return imprimirEnvCi(deps)
  if (argv.length === 1 && argv[0] === '--grafana') return imprimirGrafana(deps)
  deps.stderr(`ai-bom: argumento desconhecido (${argv.join(' ')}).\n${USO}`)
  return 2
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const cwd = process.cwd()
  const real = {
    cwd,
    env: process.env,
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
