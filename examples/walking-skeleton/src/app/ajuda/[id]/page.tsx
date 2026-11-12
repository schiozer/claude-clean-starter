import { notFound } from 'next/navigation'
import { ajudaHandlers } from '@/composition'
import { pageRequest } from '@/shared/http/pageRequest'
import { AjudaAviso } from '@/ui/components/AjudaIndice'
import { AjudaPassoAPasso } from '@/ui/components/AjudaPassoAPasso'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AjudaCenarioPage({ params }: Props) {
  const { id } = await params
  const resultado = await ajudaHandlers.abrir(await pageRequest(`/ajuda/${id}`), id)
  if (!resultado.ok && resultado.code === 'NOT_FOUND') notFound()
  if (!resultado.ok) return <AjudaAviso titulo="Ajuda" resultado={resultado} />
  return <AjudaPassoAPasso doc={resultado.valor} />
}
