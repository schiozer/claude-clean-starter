import { isResourcesEnabled } from '@/shared/featureFlags'
import { ResourcesView } from '@/presentation/components/ResourcesView'

export const dynamic = 'force-dynamic'

export default function ResourcesPage() {
  if (!isResourcesEnabled()) {
    return <main>Funcionalidade desativada.</main>
  }
  return <ResourcesView />
}
