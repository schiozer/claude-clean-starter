// read-guard: PreToolUse (matcher Read). Evita que uma única leitura encha o contexto, porque tudo
// o que entra na conversa volta a cada turno pelo cache.
//
//   texto  > TEXT_MAX_BYTES lido inteiro (sem offset/limit) -> nega, com receita de fatia
//   PDF   >= PDF_MAX_BYTES lido inteiro (sem `pages`)       -> nega, com receita de pdftotext
//
// Leituras com fatia sempre passam; imagens e notebooks são ignorados; qualquer erro ou arquivo
// ausente = sem opinião (fail-open). READ_GUARD=off desliga.
// Política: docs/guides/model-effort-tokens-guide.md ("Leia pequeno").

import { statSync } from 'node:fs'
import { resolve } from 'node:path'

export const TEXT_MAX_BYTES = 60 * 1024
export const PDF_MAX_BYTES = 1024 * 1024

const IGNORADOS = /\.(png|jpe?g|gif|webp|svg|ipynb)$/i
const PDF = /\.pdf$/i

const presente = (valor) => valor !== undefined && valor !== null && valor !== '' && valor !== 0

/** Motivo do bloqueio, ou null quando o Read pode seguir. */
export function classifyRead(toolInput, cwd) {
  if (typeof toolInput !== 'object' || toolInput === null) return null
  const arquivo = toolInput.file_path
  if (typeof arquivo !== 'string' || arquivo === '' || IGNORADOS.test(arquivo)) return null

  let tamanho
  try {
    tamanho = statSync(resolve(cwd, arquivo)).size
  } catch {
    return null
  }

  if (PDF.test(arquivo)) {
    if (typeof toolInput.pages === 'string' && toolInput.pages.trim() !== '') return null
    if (tamanho < PDF_MAX_BYTES) return null
    const mb = (tamanho / 1024 / 1024).toFixed(1)
    return (
      `read-guard: ${arquivo} é um PDF de ${mb} MB; lido inteiro enche o contexto e volta a cada turno. ` +
      `Extraia o texto uma vez: pdftotext -layout "<pdf>" /tmp/<nome>.txt, e use rg -n / Read com offset no .txt. ` +
      `Sem pdftotext, ou se a parte visual importa, repita o Read com pages (ex.: "1-5"), só as páginas necessárias.`
    )
  }

  // `offset: 1` sem `limit` equivale a ler o arquivo inteiro: só conta como fatia com limit ou offset > 1.
  if (presente(toolInput.limit) || (presente(toolInput.offset) && toolInput.offset !== 1))
    return null
  if (tamanho <= TEXT_MAX_BYTES) return null
  const kb = Math.round(tamanho / 1024)
  return (
    `read-guard: ${arquivo} tem ${kb} KB. Leia só o necessário: rg -n '<padrão>' para localizar e Read com ` +
    `offset/limit; ou delegue a um subagente que devolve um resumo.`
  )
}

/** Saída do hook (JSON de deny) para o payload bruto do Claude Code, ou '' sem opinião. */
export function evaluateRead(raw, env = process.env, cwdFallback = process.cwd()) {
  if (env.READ_GUARD === 'off') return ''
  try {
    const payload = JSON.parse(raw || '{}')
    if (payload.tool_name !== 'Read') return ''
    const motivo = classifyRead(payload.tool_input, payload.cwd ?? cwdFallback)
    if (!motivo) return ''
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: motivo,
      },
    })
  } catch {
    return ''
  }
}
