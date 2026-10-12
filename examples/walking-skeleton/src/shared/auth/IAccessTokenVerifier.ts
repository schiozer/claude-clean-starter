import type { AuthUser } from './AuthUser'

/** Bearer token (JWT OAuth ou PAT) → AuthUser. Token inválido → UnauthorizedError. */
export interface IAccessTokenVerifier {
  verify(token: string): Promise<AuthUser>
}
