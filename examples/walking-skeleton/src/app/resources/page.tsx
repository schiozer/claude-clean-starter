import { isEnabled } from '@/shared/featureFlags'
import { ResourcesView } from '@/ui/components/ResourcesView'

export const dynamic = 'force-dynamic'

export default function ResourcesPage() {
  if (!isEnabled('resources')) {
    return <main>Funcionalidade desativada.</main>
  }
  return <ResourcesView />
}
