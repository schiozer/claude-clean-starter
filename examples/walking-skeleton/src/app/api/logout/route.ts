import { e2eSessions } from '@/composition'
import { E2eCookieAuthProvider } from '@/shared/auth/E2eCookieAuthProvider'

export const dynamic = 'force-dynamic'

/** POST /api/logout — revoga a sessão no servidor e apaga o cookie (RNF-SES-003). */
export async function POST(req: Request): Promise<Response> {
  if (!e2eSessions) return new Response(null, { status: 404 })
  const session = e2eSessions.sessionOf(req)
  if (session) e2eSessions.revoke(session.sessionId)
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': E2eCookieAuthProvider.clearCookie() },
  })
}
