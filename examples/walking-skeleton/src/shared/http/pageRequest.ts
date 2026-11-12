import { headers } from 'next/headers'

/**
 * `Request` equivalente ao da página (server component), para resolver o ator pela mesma sessão
 * das rotas de API. Só o cookie interessa ao `IAuthProvider`.
 */
export async function pageRequest(path: string): Promise<Request> {
  const cookie = (await headers()).get('cookie')
  return new Request(new URL(path, 'http://localhost'), {
    headers: cookie ? { cookie } : {},
  })
}
