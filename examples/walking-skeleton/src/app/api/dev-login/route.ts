import { e2eSessions } from '@/composition'
import { isE2ePerfil } from '@/shared/auth/E2eCookieAuthProvider'

export const dynamic = 'force-dynamic'

/** Só caminho relativo com uma única `/` inicial; o resto cai em `/` (sem open redirect). */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/'
  return next
}

/** GET /api/dev-login?perfil=usuario|interno&next=/x — login stub do modo E2E local. */
export async function GET(req: Request): Promise<Response> {
  if (!e2eSessions) return new Response(null, { status: 404 })
  const params = new URL(req.url).searchParams
  const perfil = params.get('perfil')
  if (!isE2ePerfil(perfil)) {
    return Response.json(
      { error: 'Perfil inválido: use usuario ou interno', code: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }
  const { cookie } = e2eSessions.issue(perfil)
  return new Response(null, {
    status: 302,
    headers: { location: safeNext(params.get('next')), 'set-cookie': cookie },
  })
}
