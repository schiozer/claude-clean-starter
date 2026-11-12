import { NextResponse, type NextRequest } from 'next/server'
import { isE2eLocalEnvironment } from '@/shared/appEnv'
import {
  E2E_SESSION_COOKIE,
  E2eCookieAuthProvider,
  loadE2eSessionConfig,
} from '@/shared/auth/E2eCookieAuthProvider'

/**
 * Só no modo E2E local: rota de tela sem sessão válida → `302 /dev-login?next=<origem>`
 * (RNF-SES-002); sessão válida → renova a inatividade. Nos outros modos não faz nada. A revogação
 * (logout) é checada nas rotas de API, que guardam o estado da sessão.
 */
export function middleware(req: NextRequest): NextResponse {
  if (!isE2eLocalEnvironment()) return NextResponse.next()
  const { pathname, search } = req.nextUrl
  if (pathname.startsWith('/api/') || pathname === '/dev-login') return NextResponse.next()

  const value = req.cookies.get(E2E_SESSION_COOKIE)?.value
  const renewed = value
    ? E2eCookieAuthProvider.renew(value, { ...loadE2eSessionConfig(), now: Date.now() })
    : null
  if (!renewed) {
    const login = new URL('/dev-login', req.url)
    login.searchParams.set('next', `${pathname}${search}`)
    return NextResponse.redirect(login, 302)
  }
  const res = NextResponse.next()
  res.headers.append('set-cookie', renewed)
  return res
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
