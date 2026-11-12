// Gravação dos vídeos de demo/treinamento (`npm run demos:gravar`, `E2E_DEMOS=1`): legenda com o
// passo corrente no rodapé e destaque do elemento clicado. Só age em cenários `@demo`/`@treinamento`.
import type { Cenario } from './indice'
import type { GanchoDePasso } from './jornada'

export const LEGENDA_ID = 'e2e-legenda'
export const CHAVE_LEGENDA = 'e2e-legenda'

export const ehCenarioDeVideo = (c: Cenario): boolean =>
  c.destinos.includes('@demo') || c.destinos.includes('@treinamento')

/**
 * Autocontida: é serializada e executada no navegador (`addInitScript`/`evaluate`), então não pode
 * usar nada do escopo do módulo. Idempotente.
 */
export function instalarLegenda(inicial?: string): void {
  const ID = 'e2e-legenda'
  const CHAVE = 'e2e-legenda'
  // Semente do 1º passo: o init script roda a cada navegação e não pode sobrescrever passos
  // posteriores. about:blank nega o acesso ao sessionStorage.
  try {
    if (inicial && sessionStorage.getItem(CHAVE) === null) sessionStorage.setItem(CHAVE, inicial)
  } catch {
    // sem sessionStorage neste documento
  }
  const montar = () => {
    if (document.getElementById(ID) || !document.body) return
    const div = document.createElement('div')
    div.id = ID
    div.setAttribute('aria-hidden', 'true')
    div.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:12px 16px;' +
      'background:rgba(0,0,0,.8);color:#fff;font:600 18px system-ui,sans-serif;' +
      'text-align:center;pointer-events:none'
    // about:blank (antes da 1ª navegação) nega o acesso ao sessionStorage.
    try {
      div.textContent = sessionStorage.getItem(CHAVE) ?? ''
    } catch {
      div.textContent = ''
    }
    document.body.append(div)
  }
  montar()
  if (!document.getElementById(ID)) document.addEventListener('DOMContentLoaded', montar)

  const marca = '__e2eDestaque'
  const janela = window as unknown as Record<string, unknown>
  if (janela[marca]) return
  janela[marca] = true
  document.addEventListener(
    'pointerdown',
    (event) => {
      const alvo = event.target
      if (!(alvo instanceof HTMLElement)) return
      const anterior = alvo.style.outline
      alvo.style.outline = '3px solid #f59e0b'
      setTimeout(() => {
        alvo.style.outline = anterior
      }, 800)
    },
    true
  )
}

const atualizarTexto = ({ chave, id, texto }: { chave: string; id: string; texto: string }) => {
  // about:blank (antes da 1ª navegação) nega o acesso ao sessionStorage: a legenda só vale após o goto.
  try {
    sessionStorage.setItem(chave, texto)
  } catch {
    return
  }
  const div = document.getElementById(id)
  if (div) div.textContent = texto
}

export const makeGanchoDeLegenda = (): GanchoDePasso => async (ctx) => {
  const { page } = ctx
  if (!page || !ehCenarioDeVideo(ctx.cenario)) return
  if (ctx.indice === 0) {
    await page.addInitScript(instalarLegenda, `${ctx.palavra} ${ctx.texto}`)
    await page.evaluate(instalarLegenda as () => void)
  }
  try {
    await page.evaluate(atualizarTexto, {
      chave: CHAVE_LEGENDA,
      id: LEGENDA_ID,
      texto: `${ctx.palavra} ${ctx.texto}`,
    })
  } catch (erro) {
    // Legenda é cosmética: uma navegação no meio do passo não pode reprovar o teste de demo.
    if (!/Execution context was destroyed|navigation/i.test(String(erro))) throw erro
  }
}
