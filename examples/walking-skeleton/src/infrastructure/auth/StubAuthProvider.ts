import type { IAuthProvider, AuthUser } from '@/domain/interfaces/IAuthProvider'

export class StubAuthProvider implements IAuthProvider {
  async getUser(_req: Request): Promise<AuthUser | null> {
    return { id: 'dev-user' }
  }
}
