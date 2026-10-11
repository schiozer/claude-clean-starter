export type { AuthUser, AuthVia, ResolveActor } from './AuthUser'
export { requireScope, hasScope, assertOwnership } from './guards'
export { StubAuthProvider, makeSessionResolver, type IAuthProvider } from './session'
