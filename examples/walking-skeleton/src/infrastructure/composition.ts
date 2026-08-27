import { InMemoryResourceRepository } from '@/infrastructure/repositories/InMemoryResourceRepository'
import { StubAuthProvider } from '@/infrastructure/auth/StubAuthProvider'

export const resourceRepository = new InMemoryResourceRepository()
export const authProvider = new StubAuthProvider()
