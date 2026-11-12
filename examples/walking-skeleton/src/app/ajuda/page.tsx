import { ajudaHandlers } from '@/composition'
import { pageRequest } from '@/shared/http/pageRequest'
import { AjudaIndice } from '@/ui/components/AjudaIndice'

export const dynamic = 'force-dynamic'

export default async function AjudaPage() {
  const resultado = await ajudaHandlers.listar(await pageRequest('/ajuda'))
  return <AjudaIndice resultado={resultado} />
}
