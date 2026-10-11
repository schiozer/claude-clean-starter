import { isDevEnvironment } from '@/shared/appEnv'
import { UnauthorizedError } from '@/shared/errors'
import type { AuthUser, ResolveActor } from './AuthUser'

/** Login/sessão web (ex.: Auth0 Universal Login + cookie) → AuthUser. */
export interface IAuthProvider {
  getUser(req: Request): Promise<AuthUser | null>
}

/** Sessão fake para o Dev local. Fora do Dev não autentica ninguém. */
export class StubAuthProvider implements IAuthProvider {
  async getUser(_req: Request): Promise<AuthUser | null> {
    if (!isDevEnvironment()) return null
    return {
      id: 'dev-user',
      tenantId: 'dev-tenant',
      scopes: ['resources:read', 'resources:write'],
      via: 'session',
    }
  }
}

export function makeSessionResolver(provider: IAuthProvider): ResolveActor {
  return async (req) => {
    const user = await provider.getUser(req)
    if (!user) throw new UnauthorizedError()
    return user
  }
}
