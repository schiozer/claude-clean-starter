// Cliente mínimo da REST do GitHub (fetch nativo), compartilhado pelos scripts de CI
// (main-guard, spec-gate, release). `path` é relativo a `/repos/{repository}`.

const PAGE_SIZE = 100

/**
 * @param {{
 *   token: string,
 *   repository: string,
 *   apiUrl?: string,
 *   fetchFn?: typeof fetch,
 *   userAgent: string,
 * }} opts
 */
export function makeGithubClient({
  token,
  repository,
  apiUrl = 'https://api.github.com',
  fetchFn = globalThis.fetch,
  userAgent,
}) {
  /** JSON parseado da resposta; `null` em 204 ou corpo vazio. HTTP != 2xx lança Error com `status`. */
  const call = async (method, path, body) => {
    const response = await fetchFn(`${apiUrl}/repos/${repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': userAgent,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      throw Object.assign(
        new Error(`GitHub API ${method} ${path} falhou: HTTP ${response.status}`),
        { status: response.status }
      )
    }
    if (response.status === 204) return null
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }

  /** Segue `page=N` até uma página com menos de 100 itens; `pick` extrai o array de páginas-objeto. */
  const paginate = async (path, pick = (page) => page) => {
    const items = []
    const separator = path.includes('?') ? '&' : '?'
    for (let page = 1; ; page++) {
      const batch = pick(await call('GET', `${path}${separator}per_page=${PAGE_SIZE}&page=${page}`))
      items.push(...batch)
      if (batch.length < PAGE_SIZE) return items
    }
  }

  return { call, paginate }
}

const runOrder = (a, b) =>
  typeof a.id === 'number' && typeof b.id === 'number'
    ? a.id - b.id
    : String(a.started_at ?? '').localeCompare(String(b.started_at ?? ''))

/**
 * Run mais recente do check `name`: maior `id` (fallback `started_at`), independente da ordem da
 * API; empate fica com o último do array.
 * @template {{ name: string, id?: number, started_at?: string | null }} T
 * @param {T[]} runs
 * @param {string} name
 * @returns {T | undefined}
 */
export const latestCheckRun = (runs, name) =>
  runs
    .filter((run) => run.name === name)
    .reduce((best, run) => (!best || runOrder(run, best) >= 0 ? run : best), undefined)
