import type { AuthUser } from '@/shared/auth'

export function makeActor(overrides: Partial<AuthUser> = {}): AuthUser {
  return { id: 'user-1', tenantId: 'tenant-1', scopes: [], via: 'session', ...overrides }
}
