const BASE = 'http://local'
const CONTROL_CHARS = /[\x00-\x1f\x7f]/

/**
 * Destino do redirect pós-login (`?next=`) sem open redirect: só caminho do próprio app. Rejeita
 * caracteres de controle (o parser WHATWG remove tab/LF, e `/\t/evil.com` vira `//evil.com`) e
 * resolve como o navegador; origem diferente → `/`. Após normalizar (`/.`, `/..`), um `pathname`
 * iniciado por `//` ou `/\` seria protocol-relative no `Location` (`/.//evil.com`) → `/`.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || CONTROL_CHARS.test(next)) return '/'
  let url: URL
  try {
    url = new URL(next, BASE)
  } catch {
    return '/'
  }
  if (url.origin !== BASE) return '/'
  if (url.pathname.startsWith('//') || url.pathname.startsWith('/\\')) return '/'
  return `${url.pathname}${url.search}${url.hash}`
}
