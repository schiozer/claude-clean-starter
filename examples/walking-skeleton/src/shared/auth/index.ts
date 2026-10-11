export type { AuthUser, AuthVia, ResolveActor } from './AuthUser'
export { requireScope, hasScope, assertOwnership } from './guards'
export { StubAuthProvider, makeSessionResolver, type IAuthProvider } from './session'
export type { IAccessTokenVerifier } from './IAccessTokenVerifier'
export {
  InMemoryPersonalTokenStore,
  PersonalTokenVerifier,
  hashToken,
  PAT_PREFIX,
  type PersonalTokenRecord,
  type IssueTokenInput,
} from './personalTokens'
export { Auth0JwtVerifier, type Auth0JwtVerifierOptions } from './Auth0JwtVerifier'
