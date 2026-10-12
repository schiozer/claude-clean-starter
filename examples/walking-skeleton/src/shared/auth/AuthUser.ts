export type AuthVia = 'session' | 'oauth' | 'pat' | 'system'

export interface AuthUser {
  id: string
  tenantId: string
  scopes: string[]
  via: AuthVia
}

/** Borda → AuthUser; lança UnauthorizedError quando não há identidade válida. */
export type ResolveActor = (req: Request) => Promise<AuthUser>
