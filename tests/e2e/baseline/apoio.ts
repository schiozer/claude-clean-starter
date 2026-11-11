// Apoio dos testes do baseline (RNF e usabilidade): leitura dos parâmetros do `docs/rnf.md`,
// segredos exigidos e chamada JSON-RPC ao MCP. Sem valores fixos: tudo vem do baseline ou do env.
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { parametro } from '../support'

/** Valor obrigatório do env da suíte; ausente → erro com o nome da variável (nunca o valor). */
export const exigir = (valor: string | null, variavel: string): string => {
  if (!valor) {
    throw new Error(
      `${variavel} ausente: configure o segredo da suíte E2E (runbook e2e-uat-configurar)`
    )
  }
  return valor
}

/** Parâmetro de lista (`a, b`) do `docs/rnf.md`. */
export const parametroLista = (chave: string): string[] =>
  parametro(chave)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** Parâmetro inteiro não negativo do `docs/rnf.md`. */
export const parametroInteiro = (chave: string): number => {
  const valor = Number(parametro(chave))
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new Error(`rnf: parâmetro '${chave}' deve ser um inteiro ≥ 0`)
  }
  return valor
}

/** Orçamento de performance com a `margemDePerformance` (%) do baseline aplicada. */
export const orcamentoComMargem = (ms: number): number =>
  ms * (1 + parametroInteiro('margemDePerformance') / 100)

/** Resultado de `tools/call` (MCP) no formato que os testes afirmam. */
export interface ResultadoTool {
  isError?: boolean
  structuredContent?: unknown
  _meta?: { code?: string }
}

/** `POST /api/mcp` com JSON-RPC; `token` null → sem `Authorization`. */
export const chamarMcp = (
  request: APIRequestContext,
  token: string | null,
  method: string,
  params: unknown = {}
): Promise<APIResponse> =>
  request.post('/api/mcp', {
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    data: { jsonrpc: '2.0', id: 1, method, params },
  })

/** `tools/call` e devolve o `result` (falha se a resposta não for um JSON-RPC 200). */
export const chamarTool = async (
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<ResultadoTool> => {
  const res = await chamarMcp(request, token, 'tools/call', { name, arguments: args })
  if (res.status() !== 200) {
    throw new Error(`tools/call ${name}: HTTP ${res.status()} — ${await res.text()}`)
  }
  const corpo = (await res.json()) as { result?: ResultadoTool }
  if (!corpo.result) throw new Error(`tools/call ${name}: resposta sem result`)
  return corpo.result
}

const TRAVA_VENCIDA_MS = 5 * 60_000

/**
 * Executa `fn` com exclusão mútua entre workers (diretório-trava no `outputDir` do projeto). Para
 * testes que disputam um recurso compartilhado do app — ex.: a janela do rate limit do mesmo PAT
 * sob `--repeat-each`. Trava mais velha que 5 min é tida como abandonada.
 */
export const comTrava = async <T>(
  nome: string,
  espera: number,
  fn: () => Promise<T>
): Promise<T> => {
  const trava = join(test.info().project.outputDir, `.trava-${nome}`)
  const fim = Date.now() + espera
  for (;;) {
    try {
      mkdirSync(trava, { recursive: false })
      break
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
        mkdirSync(test.info().project.outputDir, { recursive: true })
        continue
      }
      if ((erro as NodeJS.ErrnoException).code !== 'EEXIST') throw erro
      const idade = Date.now() - (statSync(trava, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
      if (idade > TRAVA_VENCIDA_MS) rmSync(trava, { recursive: true, force: true })
      else if (Date.now() > fim) throw new Error(`trava '${nome}' ocupada por mais de ${espera} ms`)
      else await new Promise((r) => setTimeout(r, 500))
    }
  }
  try {
    return await fn()
  } finally {
    rmSync(trava, { recursive: true, force: true })
  }
}
