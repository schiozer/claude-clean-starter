import type { AuthUser } from '@/domain/interfaces/IAuthProvider'
import { UnauthorizedError } from '@/shared/errors'

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw new UnauthorizedError()
  return user
}

// Reservado para futuros use-cases de update/delete; a fatia atual (create/list)
// já impõe o isolamento por owner estruturalmente via findByOwnerId.
export function assertOwnership(user: AuthUser, ownerId: string): void {
  if (user.id !== ownerId) throw new UnauthorizedError()
}
