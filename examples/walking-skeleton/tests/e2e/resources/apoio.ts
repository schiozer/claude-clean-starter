// Apoio dos cenários do módulo `resources` (spec examples/walking-skeleton/docs/specs/resources.md):
// título único por execução e chamada JSON-RPC ao MCP. Sem dependência do baseline.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { dado } from '../../../../../tests/e2e/support'

/**
 * Título gravado de um cenário: o texto da spec + um sufixo único. Desktop, mobile e repetições
 * dividem o mesmo usuário e a mesma lista; sem o sufixo, dois testes veriam o recurso um do outro.
 */
export const tituloUnico = (texto: string): string => {
  const { project, repeatEachIndex, retry } = test.info()
  const sufixo = `${project.name}-${repeatEachIndex}${retry}-${Date.now().toString(36).slice(-5)}`
  return dado(`${texto} ${sufixo}`)
}

/** Valor obrigatório do env da suíte; ausente → erro com o nome da variável (nunca o valor). */
export const exigir = (valor: string | null, variavel: string): string => {
  if (!valor) {
    throw new Error(
      `${variavel} ausente: configure o segredo da suíte E2E (runbook e2e-uat-configurar)`
    )
  }
  return valor
}

/** Abre a tela de recursos e espera a primeira carga da lista terminar. */
export const abrirRecursos = async (page: Page): Promise<void> => {
  await page.goto('/resources')
  await expect(page, 'abriu a tela (sessão válida)').toHaveURL(/\/resources$/)
  await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible()
  await expect(page.locator('[aria-busy="true"]'), 'lista carregada').toHaveCount(0)
}

interface RespostaMcp<T> {
  result?: T
}

/** `POST /api/mcp` (JSON-RPC) com o PAT; falha se a resposta não for 200 com `result`. */
export const chamarMcp = async <T>(
  request: APIRequestContext,
  token: string,
  method: string,
  params: unknown = {}
): Promise<T> => {
  const res = await request.post('/api/mcp', {
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    data: { jsonrpc: '2.0', id: 1, method, params },
  })
  if (res.status() !== 200) throw new Error(`MCP ${method}: HTTP ${res.status()}`)
  const corpo = (await res.json()) as RespostaMcp<T>
  if (!corpo.result) throw new Error(`MCP ${method}: resposta sem result`)
  return corpo.result
}

export interface ResultadoTool {
  isError?: boolean
  structuredContent?: unknown
  _meta?: { code?: string }
}

export interface Recurso {
  id: string
  title: string
  ownerId: string
}

interface PaginaDeRecursos {
  items: Recurso[]
  nextCursor: string | null
}

const LIMITE_DE_PAGINAS = 50

/** Percorre todas as páginas (`nextCursor`) de uma listagem e devolve todos os itens. */
export const todasAsPaginas = async (
  buscar: (cursor: string | null) => Promise<PaginaDeRecursos>
): Promise<Recurso[]> => {
  const itens: Recurso[] = []
  let cursor: string | null = null
  for (let i = 0; i < LIMITE_DE_PAGINAS; i++) {
    const pagina = await buscar(cursor)
    itens.push(...pagina.items)
    if (!pagina.nextCursor) return itens
    cursor = pagina.nextCursor
  }
  throw new Error(`listagem com mais de ${LIMITE_DE_PAGINAS} páginas`)
}

/** Todos os recursos do ator do PAT pela tool MCP `list_resources` (falha se a tool recusar). */
export const listarPeloMcp = (request: APIRequestContext, token: string): Promise<Recurso[]> =>
  todasAsPaginas(async (cursor) => {
    const result = await chamarMcp<ResultadoTool>(request, token, 'tools/call', {
      name: 'list_resources',
      arguments: { limit: 50, ...(cursor ? { cursor } : {}) },
    })
    expect(result.isError, `list_resources recusada (${result._meta?.code ?? '—'})`).toBeFalsy()
    return result.structuredContent as PaginaDeRecursos
  })

/** Todos os recursos do ator da sessão em `GET /api/resources` (falha se não for 200). */
export const listarPelaApi = (request: APIRequestContext): Promise<Recurso[]> =>
  todasAsPaginas(async (cursor) => {
    const res = await request.get('/api/resources', {
      params: { limit: 50, ...(cursor ? { cursor } : {}) },
    })
    expect(res.status(), 'GET /api/resources').toBe(200)
    return (await res.json()) as PaginaDeRecursos
  })
