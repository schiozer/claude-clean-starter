import { ForbiddenError } from '@/shared/errors'
import type { AuthUser } from './AuthUser'

export function hasScope(actor: AuthUser, scope: string): boolean {
  return actor.scopes.includes(scope)
}

export function requireScope(actor: AuthUser, scope: string): void {
  if (!hasScope(actor, scope)) throw new ForbiddenError(`Permissão ausente: ${scope}`)
}

export function assertOwnership(actor: AuthUser, ownerId: string): void {
  if (actor.id !== ownerId) throw new ForbiddenError()
}
