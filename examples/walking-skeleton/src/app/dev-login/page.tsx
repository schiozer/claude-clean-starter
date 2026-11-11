import { notFound, redirect } from 'next/navigation'
import { isE2eLocalEnvironment } from '@/shared/appEnv'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ perfil?: string | string[]; next?: string | string[] }>
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

const loginUrl = (perfil: string, next: string | undefined): string => {
  const params = new URLSearchParams({ perfil })
  if (next !== undefined) params.set('next', next)
  return `/api/dev-login?${params}`
}

/** Login stub do modo E2E local: com `perfil`, entra direto; sem, oferece os perfis. */
export default async function DevLoginPage({ searchParams }: Props) {
  if (!isE2eLocalEnvironment()) notFound()
  const params = await searchParams
  const perfil = first(params.perfil)
  const next = first(params.next)
  if (perfil !== undefined) redirect(loginUrl(perfil, next))
  return (
    <main>
      <h1>Entrar (modo e2e)</h1>
      <ul>
        <li>
          <a href={loginUrl('usuario', next)}>Entrar como usuário</a>
        </li>
        <li>
          <a href={loginUrl('interno', next)}>Entrar como interno</a>
        </li>
      </ul>
    </main>
  )
}
