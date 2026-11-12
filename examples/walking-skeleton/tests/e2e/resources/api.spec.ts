// Cenários sistêmicos do módulo `resources` (spec examples/walking-skeleton/docs/specs/resources.md
// §8): REST e MCP sem navegador, no projeto `sistemico`. Nunca usa o PAT do rate limit (reservado
// ao RNF-SEG-005) nem o PAT sem escopo.
import {
  cabecalhosDeBypass,
  e2eEnv,
  jornada,
  perfis,
  expect,
  test,
} from '../../../../../tests/e2e/support'
import {
  chamarMcp,
  exigir,
  listarPeloMcp,
  listarPelaApi,
  tituloUnico,
  type Recurso,
  type ResultadoTool,
} from './apoio'

test.describe('com sessão do usuário final', () => {
  test.use({ storageState: perfis.usuario })

  test(
    'CT-RES-004 a api lista só os recursos do ator e recusa quem não está logado',
    { tag: ['@sistemico', '@regressao'] },
    async ({ request, playwright, baseURL }) => {
      const titulo = tituloUnico('Plano de estudos')
      const tituloSemSessao = tituloUnico('Sem sessão')
      const outroAtor = exigir(e2eEnv().pat.outroAtor, 'E2E_PAT_OUTRO_ATOR')
      let doUsuario: string[] = []
      let doOutro: Recurso[] = []
      await jornada('CT-RES-004', {
        'que o usuário final criou o recurso "Plano de estudos" com a sessão dele': async () => {
          const res = await request.post('/api/resources', { data: { title: titulo } })
          expect(res.status(), 'POST /api/resources com sessão').toBe(201)
        },
        'ele lista os recursos em "GET /api/resources"': async () => {
          doUsuario = (await listarPelaApi(request)).map((r) => r.title)
        },
        'o recurso "Plano de estudos" aparece para ele': async () => {
          expect(doUsuario, 'o dono vê o recurso pela API REST').toContain(titulo)
          // Controle da borda MCP: o dono também o vê por `list_resources` — a ausência para o
          // outro ator, abaixo, é isolamento, não uma listagem quebrada.
          const token = exigir(e2eEnv().pat.usuario, 'E2E_PAT_USUARIO')
          const doDono = await listarPeloMcp(request, token)
          expect(
            doDono.map((r) => r.title),
            'o dono vê o recurso pelo MCP'
          ).toContain(titulo)
        },
        'outro ator lista os recursos pela tool MCP "list_resources"': async () => {
          doOutro = await listarPeloMcp(request, outroAtor)
        },
        'o recurso "Plano de estudos" não aparece para o outro ator': async () => {
          expect(
            doOutro.map((r) => r.title),
            'o outro ator não vê o recurso do usuário final'
          ).not.toContain(titulo)
          expect(
            doOutro.filter((r) => r.ownerId !== 'e2e-outro-ator'),
            'só recursos do próprio outro ator'
          ).toEqual([])
        },
        'alguém sem sessão tenta criar um recurso em "POST /api/resources"': async () => {
          // Contexto sem cookies: o `newContext` herdaria o `storageState` do `test.use`.
          // Mesmo `baseURL`: leva o bypass da Vercel no modo preview, como o `request` do teste.
          const anonimo = await playwright.request.newContext({
            baseURL,
            extraHTTPHeaders: cabecalhosDeBypass(e2eEnv()) ?? undefined,
            storageState: { cookies: [], origins: [] },
          })
          try {
            const res = await anonimo.post('/api/resources', { data: { title: tituloSemSessao } })
            expect(res.status(), 'POST sem sessão').toBe(401)
            const corpo = (await res.json()) as { code?: string }
            expect(corpo.code).toBe('UNAUTHORIZED')
          } finally {
            await anonimo.dispose()
          }
        },
        'a API responde 401 e nada é criado': async () => {
          const titulos = (await listarPelaApi(request)).map((r) => r.title)
          expect(titulos, 'nada criado sem sessão').not.toContain(tituloSemSessao)
        },
      })
    }
  )
})

test(
  'CT-RES-005 o mcp não oferece a criação com a escrita desligada',
  { tag: ['@sistemico', '@regressao'] },
  async ({ request }) => {
    const token = exigir(e2eEnv().pat.usuario, 'E2E_PAT_USUARIO')
    let tools: string[] = []
    await jornada('CT-RES-005', {
      'que a flag "mcp.resources.write" está desligada': async () => {
        // Com a flag desligada a tool não existe para o servidor: a chamada direta é recusada.
        const result = await chamarMcp<ResultadoTool>(request, token, 'tools/call', {
          name: 'create_resource',
          arguments: { title: tituloUnico('Escrita desligada') },
        })
        expect(result.isError, 'create_resource recusada').toBe(true)
        expect(result._meta?.code).toBe('NOT_FOUND')
      },
      'o usuário final pede a lista de tools ao MCP com o token pessoal dele': async () => {
        const result = await chamarMcp<{ tools: { name: string }[] }>(request, token, 'tools/list')
        tools = result.tools.map((t) => t.name)
      },
      'a tool "list_resources" aparece na lista': async () => {
        expect(tools).toContain('list_resources')
      },
      'a tool "create_resource" não aparece': async () => {
        expect(tools).not.toContain('create_resource')
      },
    })
  }
)
