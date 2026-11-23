import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * @typedef {{ integracao: string, producao: string, prefixoHotfix: string, promotores: string[] }} Esteira
 */

const textoNaoVazio = (valor) => typeof valor === 'string' && valor.trim() !== ''

/** Valida o bloco `esteira` do config. Ausente → null (esteira desligada); inválido → Error. */
export function parseEsteira(json) {
  if (json === undefined || json === null) return null
  if (typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('esteira: o bloco deve ser um objeto')
  }
  for (const campo of ['integracao', 'producao', 'prefixoHotfix']) {
    if (!textoNaoVazio(json[campo])) {
      throw new Error(`esteira: ${campo} deve ser um texto não vazio`)
    }
  }
  const { promotores } = json
  if (!Array.isArray(promotores) || promotores.length === 0 || !promotores.every(textoNaoVazio)) {
    throw new Error('esteira: promotores deve ser uma lista não vazia de logins')
  }
  if (json.integracao === json.producao) {
    throw new Error('esteira: integracao deve ser diferente de producao')
  }
  return {
    integracao: json.integracao,
    producao: json.producao,
    prefixoHotfix: json.prefixoHotfix,
    promotores: [...promotores],
  }
}

/** Lê `hooks/protect-main/config.json` da raiz e devolve a esteira (ou null). */
export function lerEsteira(raiz = process.cwd()) {
  const config = JSON.parse(readFileSync(resolve(raiz, 'hooks/protect-main/config.json'), 'utf8'))
  return parseEsteira(config.esteira)
}
