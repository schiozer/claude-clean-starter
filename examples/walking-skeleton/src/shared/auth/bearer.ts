import { UnauthorizedError } from '@/shared/errors'
import type { AuthUser } from './AuthUser'
import type { IAccessTokenVerifier } from './IAccessTokenVerifier'
import { PAT_PREFIX } from './personalTokens'

export function readBearerToken(req: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')
  const token = match?.[1]?.trim()
  return token ? token : null
}

/** Escolhe o verificador pelo formato do token (ADR-012). */
export class CompositeTokenVerifier implements IAccessTokenVerifier {
  constructor(
    private readonly pat: IAccessTokenVerifier,
    private readonly jwt: IAccessTokenVerifier | null
  ) {}

  async verify(token: string): Promise<AuthUser> {
    if (token.startsWith(PAT_PREFIX)) return this.pat.verify(token)
    if (!this.jwt) throw new UnauthorizedError('OAuth não configurado neste ambiente')
    return this.jwt.verify(token)
  }
}
