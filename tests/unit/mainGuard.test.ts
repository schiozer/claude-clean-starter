import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeGithubApi, runMainGuard } from '../../scripts/main-guard.mjs'

const ROOT = resolve(__dirname, '../..')
const ZERO = '0'.repeat(40)
const AFTER = 'a'.repeat(40)
const BEFORE = 'b'.repeat(40)
const SHA = 'c'.repeat(40)

const merged = (ref = 'main') => ({ merged_at: '2026-01-01T00:00:00Z', base: { ref } })

const makeApi = (overrides: Record<string, unknown> = {}) => ({
  compare: vi.fn(async () => [SHA]),
  pullsForCommit: vi.fn(async () => [merged()]),
  findOpenIssue: vi.fn(async () => null),
  createIssue: vi.fn(async () => undefined),
  comment: vi.fn(async () => undefined),
  ...overrides,
})

const event = (extra = {}) => ({
  ref: 'refs/heads/main',
  before: BEFORE,
  after: AFTER,
  forced: false,
  ...extra,
})

const opts = { retries: 3, delayMs: 0, protectedBranches: ['main'] }

describe('runMainGuard', () => {
  it('ok quando o commit tem PR mergeado na main', async () => {
    const api = makeApi()
    const result = await runMainGuard(event(), api, opts)
    expect(result).toEqual({ ok: true, offending: [] })
    expect(api.createIssue).not.toHaveBeenCalled()
  })

  it('alarma e abre issue com o label quando não há PR', async () => {
    const api = makeApi({ pullsForCommit: vi.fn(async () => []) })
    const result = await runMainGuard(event(), api, opts)
    expect(result).toEqual({ ok: false, offending: [SHA] })
    expect(api.pullsForCommit).toHaveBeenCalledTimes(3)
    expect(api.createIssue).toHaveBeenCalledWith(
      `Commit na main sem PR: ${AFTER.slice(0, 7)}`,
      expect.stringContaining(SHA),
      'main-sem-pr'
    )
  })

  it('PR não mergeado conta como sem PR', async () => {
    const api = makeApi({
      pullsForCommit: vi.fn(async () => [{ merged_at: null, base: { ref: 'main' } }]),
    })
    expect((await runMainGuard(event(), api, opts)).ok).toBe(false)
  })

  it('PR mergeado em outra base conta como sem PR', async () => {
    const api = makeApi({ pullsForCommit: vi.fn(async () => [merged('dev')]) })
    expect((await runMainGuard(event(), api, opts)).ok).toBe(false)
  })

  it('before zerado (branch nova) é ok e não chama compare', async () => {
    const api = makeApi()
    const result = await runMainGuard(event({ before: ZERO }), api, opts)
    expect(result.ok).toBe(true)
    expect(api.compare).not.toHaveBeenCalled()
  })

  it('forced:true alarma mesmo com PRs', async () => {
    const api = makeApi()
    const result = await runMainGuard(event({ forced: true }), api, opts)
    expect(result).toEqual({ ok: false, offending: [SHA] })
    expect(api.createIssue).toHaveBeenCalled()
  })

  it('forced:true com compare falhando usa [after]', async () => {
    const api = makeApi({
      compare: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const result = await runMainGuard(event({ forced: true }), api, opts)
    expect(result).toEqual({ ok: false, offending: [AFTER] })
  })

  it('issue aberta existente recebe comentário, sem criar outra', async () => {
    const api = makeApi({
      pullsForCommit: vi.fn(async () => []),
      findOpenIssue: vi.fn(async () => 7),
    })
    await runMainGuard(event(), api, opts)
    expect(api.findOpenIssue).toHaveBeenCalledWith('main-sem-pr')
    expect(api.comment).toHaveBeenCalledWith(7, expect.stringContaining(SHA))
    expect(api.createIssue).not.toHaveBeenCalled()
  })

  it('associação que aparece só na 2ª tentativa é ok', async () => {
    const pullsForCommit = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([merged()])
    const api = makeApi({ pullsForCommit })
    const result = await runMainGuard(event(), api, opts)
    expect(result.ok).toBe(true)
    expect(pullsForCommit).toHaveBeenCalledTimes(2)
  })

  it('branch fora de protectedBranches é ok sem chamar a API', async () => {
    const api = makeApi()
    const result = await runMainGuard(event({ ref: 'refs/heads/feat/x' }), api, opts)
    expect(result.ok).toBe(true)
    expect(api.compare).not.toHaveBeenCalled()
  })
})

describe('runMainGuard — delete, retries e corpo', () => {
  it('delete da branch protegida alarma com [before] sem compare', async () => {
    const api = makeApi()
    const result = await runMainGuard(event({ after: ZERO, deleted: true }), api, opts)
    expect(result).toEqual({ ok: false, offending: [BEFORE] })
    expect(api.compare).not.toHaveBeenCalled()
    expect(api.createIssue).toHaveBeenCalledWith(
      `Commit na main sem PR: ${BEFORE.slice(0, 7)}`,
      expect.any(String),
      'main-sem-pr'
    )
  })

  it('after zerado sem flag deleted também alarma', async () => {
    const result = await runMainGuard(event({ after: ZERO }), makeApi(), opts)
    expect(result).toEqual({ ok: false, offending: [BEFORE] })
  })

  it('verifica todos os pendentes por rodada e dorme uma vez por rodada', async () => {
    const shas = ['1', '2', '3'].map((n) => n.repeat(40))
    const seen: Record<string, number> = {}
    const api = makeApi({
      compare: vi.fn(async () => shas),
      pullsForCommit: vi.fn(async (sha: string) => {
        seen[sha] = (seen[sha] ?? 0) + 1
        return seen[sha] >= 2 ? [merged()] : []
      }),
    })
    const result = await runMainGuard(event(), api, opts)
    expect(result.ok).toBe(true)
    expect(api.pullsForCommit).toHaveBeenCalledTimes(6)
  })

  it('corpo usa o texto combinado', async () => {
    const api = makeApi({ pullsForCommit: vi.fn(async () => []) })
    await runMainGuard(event(), api, opts)
    const body = (api.createIssue.mock.calls[0] as unknown as string[])[1]
    expect(body).toContain('Chegaram à `main` commits sem PR mergeado:')
  })
})

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const makeFetch = (handler: (url: string, init: RequestInit) => Response) => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return handler(url, init)
  })
  return { fetchFn, calls }
}

const githubApi = (fetchFn: unknown) =>
  makeGithubApi({ token: 'tok', repository: 'o/r', apiUrl: 'https://gh.test', fetchFn } as never)

describe('makeGithubApi', () => {
  it('envia headers e URLs esperados', async () => {
    const { fetchFn, calls } = makeFetch(() => json({ total_commits: 1, commits: [{ sha: SHA }] }))
    const shas = await githubApi(fetchFn).compare(BEFORE, AFTER)
    expect(shas).toEqual([SHA])
    expect(calls[0].url).toBe(
      `https://gh.test/repos/o/r/compare/${BEFORE}...${AFTER}?per_page=100&page=1`
    )
    expect(calls[0].init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'main-guard',
    })
  })

  it('pagina o compare até total_commits', async () => {
    const mk = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ sha: String(from + i) }))
    const { fetchFn, calls } = makeFetch((url) =>
      json(
        url.endsWith('page=1')
          ? { total_commits: 150, commits: mk(100, 0) }
          : { total_commits: 150, commits: mk(50, 100) }
      )
    )
    const shas = await githubApi(fetchFn).compare(BEFORE, AFTER)
    expect(shas).toHaveLength(150)
    expect(calls).toHaveLength(2)
  })

  it('truncamento do compare vira alarme com [after] e nota', async () => {
    const { fetchFn } = makeFetch((url) => {
      if (url.includes('/compare/')) {
        return json({ total_commits: 400, commits: [{ sha: SHA }] })
      }
      if (url.includes('/issues?')) return json([])
      return json({})
    })
    const result = await runMainGuard(event(), githubApi(fetchFn), opts)
    expect(result).toEqual({ ok: false, offending: [AFTER] })
    const post = fetchFn.mock.calls.find(([u]) => u.endsWith('/issues'))
    expect(String(post?.[1].body)).toContain('compare retornou')
  })

  it('total_commits ausente é fail-closed', async () => {
    const { fetchFn } = makeFetch((url) =>
      url.includes('/compare/') ? json({ commits: [{ sha: SHA }] }) : json([])
    )
    const result = await runMainGuard(event(), githubApi(fetchFn), opts)
    expect(result).toEqual({ ok: false, offending: [AFTER] })
  })

  it('erro de compare sem force propaga', async () => {
    const { fetchFn } = makeFetch(() => json({}, 500))
    await expect(runMainGuard(event(), githubApi(fetchFn), opts)).rejects.toThrow(/HTTP 500/)
  })

  it('cria o label antes da issue e ignora 422 do label', async () => {
    const { fetchFn, calls } = makeFetch((url) =>
      url.endsWith('/labels') ? json({}, 422) : json({})
    )
    await githubApi(fetchFn).createIssue('t', 'b', 'main-sem-pr')
    expect(calls.map((c) => c.url)).toEqual([
      'https://gh.test/repos/o/r/labels',
      'https://gh.test/repos/o/r/issues',
    ])
  })

  it('422 ao criar a issue não é ignorado', async () => {
    const { fetchFn } = makeFetch((url) => (url.endsWith('/issues') ? json({}, 422) : json({})))
    await expect(githubApi(fetchFn).createIssue('t', 'b', 'main-sem-pr')).rejects.toThrow(/422/)
  })

  it('findOpenIssue codifica o label e ignora PRs', async () => {
    const { fetchFn, calls } = makeFetch(() =>
      json([{ number: 3, pull_request: {} }, { number: 5 }])
    )
    expect(await githubApi(fetchFn).findOpenIssue('main sem/pr')).toBe(5)
    expect(calls[0].url).toBe(
      'https://gh.test/repos/o/r/issues?labels=main%20sem%2Fpr&state=open&per_page=100'
    )
  })
})

describe('workflow main-guard.yml', () => {
  it('gatilho branches cobre protectedBranches', () => {
    const yml = readFileSync(resolve(ROOT, '.github/workflows/main-guard.yml'), 'utf8')
    const line = yml.match(/^\s*branches:\s*\[([^\]]*)\]/m)
    expect(line).not.toBeNull()
    const triggers = (line?.[1] ?? '').split(',').map((b) => b.trim().replace(/['"]/g, ''))
    const config = JSON.parse(readFileSync(resolve(ROOT, 'hooks/protect-main/config.json'), 'utf8'))
    for (const branch of config.protectedBranches) expect(triggers).toContain(branch)
  })
})
