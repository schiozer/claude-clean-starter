// Único arquivo que importa infrastructure/: instancia repositórios, services e bordas.
import { ResourceService, makeResourceHandlers } from '@/modules/resources'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'
import { StubAuthProvider, makeSessionResolver } from '@/shared/auth'
import { systemClock } from '@/shared/kernel'

export const resourceRepository = new InMemoryResourceRepository()
const resourceService = new ResourceService(resourceRepository, systemClock)

const resolveSessionActor = makeSessionResolver(new StubAuthProvider())

export const resourceHandlers = makeResourceHandlers(resourceService, resolveSessionActor)
