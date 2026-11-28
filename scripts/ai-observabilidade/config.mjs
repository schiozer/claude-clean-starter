// Leitura e validação do `ai-observabilidade.config.json`.
// O tooling da raiz não tem Zod (ADR-007): validação à mão. Segredos nunca vão neste arquivo.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIG_PATH = 'ai-observabilidade.config.json'

const MENSAL_USD_PADRAO = 400
const AVISO_PCT_PADRAO = 80

// Única regra de `projeto`: vira valor de OTEL_RESOURCE_ATTRIBUTES (sem espaço, vírgula nem igual).
const PROJETO_VALIDO = /^[A-Za-z0-9_.-]+$/

const erro = (mensagem) => new Error(`${CONFIG_PATH}: ${mensagem}`)

const ehObjeto = (valor) => typeof valor === 'object' && valor !== null && !Array.isArray(valor)

const ehPositivo = (valor) => typeof valor === 'number' && Number.isFinite(valor) && valor > 0

function validarTeto(bloco) {
  if (bloco === undefined) bloco = {}
  if (!ehObjeto(bloco)) throw erro('teto deve ser um objeto')

  const mensalUsd = bloco.mensalUsd ?? MENSAL_USD_PADRAO
  if (!ehPositivo(mensalUsd)) throw erro('teto.mensalUsd deve ser um número positivo')

  const avisoPct = bloco.avisoPct ?? AVISO_PCT_PADRAO
  if (typeof avisoPct !== 'number' || !Number.isFinite(avisoPct) || avisoPct < 1 || avisoPct > 99) {
    throw erro('teto.avisoPct deve estar entre 1 e 99')
  }

  const porProjeto = bloco.porProjetoUsd ?? {}
  if (!ehObjeto(porProjeto)) throw erro('teto.porProjetoUsd deve ser um objeto')
  for (const [nome, valor] of Object.entries(porProjeto)) {
    if (!ehPositivo(valor)) throw erro(`teto.porProjetoUsd.${nome} deve ser um número positivo`)
  }

  return { mensalUsd, avisoPct, porProjetoUsd: { ...porProjeto } }
}

/**
 * `raw` null = arquivo ausente (observabilidade desligada).
 * @param {unknown | null} raw
 */
export function parseAiObsConfig(raw) {
  if (raw === null) raw = {}
  if (!ehObjeto(raw)) throw erro('JSON inválido (esperado um objeto)')

  const ativo = raw.ativo === true
  const central = raw.central === true

  let projeto = null
  if (ativo || raw.projeto !== undefined) {
    if (typeof raw.projeto !== 'string' || raw.projeto.trim() === '') {
      if (ativo) throw erro('projeto deve ser um texto não vazio')
    } else if (!PROJETO_VALIDO.test(raw.projeto)) {
      throw erro(
        'projeto deve usar só letras ASCII, números, ponto, hífen e sublinhado (sem espaços)'
      )
    } else {
      projeto = raw.projeto
    }
  }

  return { ativo, projeto, central, teto: validarTeto(raw.teto) }
}

/** @returns {'desligado' | 'emissor' | 'hub'} */
export function papel(cfg) {
  if (!cfg.ativo) return 'desligado'
  return cfg.central ? 'hub' : 'emissor'
}

/** @param {string} [dir] */
export function readAiObsConfig(dir = process.cwd()) {
  const caminho = join(dir, CONFIG_PATH)
  if (!existsSync(caminho)) return parseAiObsConfig(null)
  let json
  try {
    json = JSON.parse(readFileSync(caminho, 'utf8'))
  } catch (e) {
    throw erro(`JSON inválido (${e.message})`)
  }
  return parseAiObsConfig(json)
}
