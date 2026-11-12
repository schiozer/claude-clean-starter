import { e2eSessions } from '@/composition'
import { isE2ePerfil } from '@/shared/auth/E2eCookieAuthProvider'
import { safeNext } from '@/shared/http/safeNext'

export const dynamic = 'force-dynamic'

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
