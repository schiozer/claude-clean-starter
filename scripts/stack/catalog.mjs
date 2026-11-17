// Leitura e validação do `stack.catalog.json` (spec init-e-architecture-review §5.1).
// O tooling da raiz não tem Zod (ADR-007): validação à mão, só da forma. Caminhos que existem e
// recomendações ficam no teste do catálogo.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CATALOG_PATH = 'stack.catalog.json'

const erro = (mensagem) => new Error(`Catálogo de stack inválido: ${mensagem}`)

const ehObjeto = (valor) => typeof valor === 'object' && valor !== null && !Array.isArray(valor)
const ehTexto = (valor) => typeof valor === 'string' && valor.trim() !== ''
const ehListaDeTextos = (valor) => Array.isArray(valor) && valor.every(ehTexto)

function texto(objeto, campo, caminho) {
  if (!ehTexto(objeto[campo])) throw erro(`${caminho}.${campo} deve ser um texto não vazio`)
}

function caminhoOuNulo(objeto, campo, caminho) {
  if (objeto[campo] !== null && !ehTexto(objeto[campo])) {
    throw erro(`${caminho}.${campo} deve ser um caminho ou null`)
  }
}

function validarGrava(grava, caminho) {
  if (grava === 'nenhum') return
  if (ehObjeto(grava) && ehTexto(grava.arquivo) && ehTexto(grava.campo)) return
  if (ehObjeto(grava) && ehTexto(grava['gh-variable'])) return
  throw erro(`${caminho}.grava deve ser 'nenhum', { arquivo, campo } ou { "gh-variable" }`)
}

function validarCodigoDoApp(codigo, caminho) {
  if (!ehObjeto(codigo)) throw erro(`${caminho}.codigoDoApp deve ser um objeto`)
  for (const [formato, itens] of Object.entries(codigo)) {
    if (!ehListaDeTextos(itens)) {
      throw erro(`${caminho}.codigoDoApp.${formato} deve ser lista de textos`)
    }
  }
}

function validarOpcao(opcao, caminho) {
  if (!ehObjeto(opcao)) throw erro(`${caminho} deve ser um objeto`)
  for (const campo of ['id', 'nome', 'porque', 'adr']) texto(opcao, campo, caminho)
  if (typeof opcao.recomendada !== 'boolean') throw erro(`${caminho}.recomendada deve ser booleano`)
  if (!ehListaDeTextos(opcao.pros)) throw erro(`${caminho}.pros deve ser lista de textos`)
  if (!ehListaDeTextos(opcao.contras)) throw erro(`${caminho}.contras deve ser lista de textos`)
  caminhoOuNulo(opcao, 'setup', caminho)
  caminhoOuNulo(opcao, 'migracao', caminho)
  validarCodigoDoApp(opcao.codigoDoApp, caminho)
}

function validarDimensao(dimensao, indice) {
  const caminho = `dimensoes[${indice}]`
  if (!ehObjeto(dimensao)) throw erro(`${caminho} deve ser um objeto`)
  texto(dimensao, 'id', caminho)
  texto(dimensao, 'nome', caminho)
  validarGrava(dimensao.grava, `${caminho} (${dimensao.id})`)
  if (!Array.isArray(dimensao.opcoes) || dimensao.opcoes.length === 0) {
    throw erro(`${caminho} (${dimensao.id}).opcoes deve ter ao menos uma opção`)
  }
  dimensao.opcoes.forEach((opcao, i) => validarOpcao(opcao, `${dimensao.id}.opcoes[${i}]`))
}

export function parseCatalog(textoJson) {
  let json
  try {
    json = JSON.parse(textoJson)
  } catch (e) {
    throw erro(`JSON inválido (${e.message})`)
  }
  if (!ehObjeto(json)) throw erro('esperado um objeto')
  if (json.versao !== 1) throw erro(`versao '${json.versao}' não suportada (esperado 1)`)
  if (!Array.isArray(json.dimensoes) || json.dimensoes.length === 0) {
    throw erro('dimensoes deve ter ao menos uma dimensão')
  }
  json.dimensoes.forEach(validarDimensao)
  return json
}

export function lerCatalog(raiz = process.cwd()) {
  return parseCatalog(readFileSync(join(raiz, CATALOG_PATH), 'utf8'))
}
