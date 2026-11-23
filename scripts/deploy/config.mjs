// Leitura e validação do `deploy.config.json` (spec camada-de-deploy §5.1).
// O tooling da raiz não tem Zod (ADR-007): validação à mão. Segredos nunca vão neste arquivo.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const HOSTS = ['vercel', 'heroku', 'cloudrun']
export const CONFIG_PATH = 'deploy.config.json'

const CAMPOS_AMBIENTE = ['project', 'service', 'wifProvider', 'serviceAccount']
const AMBIENTES = ['uat', 'prod']

const erro = (mensagem) => new Error(`${CONFIG_PATH}: ${mensagem}`)

const ehObjeto = (valor) => typeof valor === 'object' && valor !== null && !Array.isArray(valor)

function textoObrigatorio(objeto, campo, caminho) {
  const valor = objeto[campo]
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw erro(`${caminho}.${campo} deve ser um texto não vazio`)
  }
  return valor
}

function validarAmbiente(bloco, nome) {
  const caminho = `cloudrun.${nome}`
  if (!ehObjeto(bloco)) throw erro(`${caminho}: bloco obrigatório`)
  const ambiente = {}
  for (const campo of CAMPOS_AMBIENTE) ambiente[campo] = textoObrigatorio(bloco, campo, caminho)
  return ambiente
}

function validarCloudRun(bloco) {
  if (!ehObjeto(bloco)) throw erro('cloudrun: bloco obrigatório')
  const cloudrun = {
    region: textoObrigatorio(bloco, 'region', 'cloudrun'),
    repository: textoObrigatorio(bloco, 'repository', 'cloudrun'),
  }
  for (const nome of AMBIENTES) cloudrun[nome] = validarAmbiente(bloco[nome], nome)
  return cloudrun
}

/**
 * `texto` null = arquivo ausente (host padrão: vercel). Com `esteira` ligada (spec
 * esteira-build-once-promote §5.6), o heroku exige também `uatApp` e `prodApp`.
 * @param {string | null} texto
 * @param {{ esteira?: object | null }} [opcoes]
 */
export function parseDeployConfig(texto, { esteira = null } = {}) {
  if (texto === null) return { host: 'vercel' }

  let json
  try {
    json = JSON.parse(texto)
  } catch (e) {
    throw erro(`JSON inválido (${e.message})`)
  }
  if (!ehObjeto(json)) throw erro('JSON inválido (esperado um objeto)')

  if (!HOSTS.includes(json.host)) {
    throw erro(`host '${json.host}' inválido (válidos: ${HOSTS.join(', ')})`)
  }

  // Bloco de vercel é aceito sem validação; o de heroku exige `pipelineId` (e, com esteira,
  // `uatApp`/`prodApp`).
  const config = { ...json }
  if (json.host === 'heroku') {
    const pipelineId = ehObjeto(json.heroku) ? json.heroku.pipelineId : undefined
    if (typeof pipelineId !== 'string' || pipelineId.trim() === '') {
      throw erro('heroku.pipelineId obrigatório (texto não vazio)')
    }
    if (esteira) {
      for (const campo of ['uatApp', 'prodApp']) {
        const valor = json.heroku[campo]
        if (typeof valor !== 'string' || valor.trim() === '') {
          throw erro(`heroku.${campo} obrigatório com a esteira ligada (texto não vazio)`)
        }
      }
    }
  }
  if (json.host === 'cloudrun') config.cloudrun = validarCloudRun(json.cloudrun)
  return config
}

export function lerDeployConfig(raiz = process.cwd()) {
  const caminho = join(raiz, CONFIG_PATH)
  return parseDeployConfig(existsSync(caminho) ? readFileSync(caminho, 'utf8') : null)
}
