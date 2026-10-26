import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeGithubApi, runMainGuard } from '../../scripts/main-guard.mjs'

const ROOT = resolve(__dirname, '../..')
const ZERO = '0'.repeat(40)
const AFTER = 'a'.repeat(40)
const BEFORE = 'b'.repeat(40)
const SHA = 'c'.repeat(40)

const HEAD = 'd'.repeat(40)
const UAT_OK = '- [x] UAT aprovado\n- [ ] UAT não se aplica — '
const REQUIRED = ['Test & Lint (root)', 'Walking Skeleton (example)', 'PR gate']

const merged = (ref = 'main', body = UAT_OK) => ({
  number: 7,
  title: 'feat(x): y',
  body,
  merged_at: '2026-01-01T00:00:00Z',
  base: { ref },
  head: { sha: HEAD },
})

const runs = (names = REQUIRED, conclusion: string | null = 'success', status = 'completed') =>
  names.map((name) => ({ name, status, conclusion }))

const makeApi = (overrides: Record<string, unknown> = {}) => ({
  compare: vi.fn(async () => [SHA]),
  pullsForCommit: vi.fn(async () => [merged()]),
  checkRuns: vi.fn(async () => runs()),
  commitParents: vi.fn(async () => ['p'.repeat(40)]),
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

const opts = {
  retries: 3,
  delayMs: 0,
  protectedBranches: ['main'],
  requiredChecks: REQUIRED,
  specGate: false,
}

describe('runMainGuard', () => {
  it('ok quando o commit tem PR mergeado na main', async () => {
    const api = makeApi()
    const result = await runMainGuard(event(), api, opts)
    expect(result).toEqual({ ok: true, offending: [], gateFailures: [] })
    expect(api.createIssue).not.toHaveBeenCalled()
  })

  it('alarma e abre issue com o label quando não há PR', async () => {
    const api = makeApi({ pullsForCommit: vi.fn(async () => []) })
    const result = await runMainGuard(event(), api, opts)
    expect(result).toEqual({ ok: false, offending: [SHA], gateFailures: [] })
    expect(api.pullsForCommit).toHaveBeenCalledTimes(3)
    expect(api.createIssue).toHaveBeenCalledWith(
      `Commit na main sem PR: ${AFTER.slice(0, 7)}`,
      expect.stringContaining(SHA),
      'main-sem-pr'
    )
  })

  it('PR não mergeado conta como sem PR', async () => {
    const api = makeApi({
      pullsForCommit: vi.fn(async () => [{ ...merged(), merged_at: null }]),
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
    expect(result).toEqual({ ok: false, offending: [SHA], gateFailures: [] })
    expect(api.createIssue).toHaveBeenCalled()
  })

  it('forced:true com compare falhando usa [after]', async () => {
    const api = makeApi({
      compare: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const result = await runMainGuard(event({ forced: true }), api, opts)
    expect(result).toEqual({ ok: false, offending: [AFTER], gateFailures: [] })
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
    expect(result).toEqual({ ok: false, offending: [BEFORE], gateFailures: [] })
    expect(api.compare).not.toHaveBeenCalled()
    expect(api.createIssue).toHaveBeenCalledWith(
      `Commit na main sem PR: ${BEFORE.slice(0, 7)}`,
      expect.any(String),
      'main-sem-pr'
    )
  })

  it('after zerado sem flag deleted também alarma', async () => {
    const result = await runMainGuard(event({ after: ZERO }), makeApi(), opts)
    expect(result).toEqual({ ok: false, offending: [BEFORE], gateFailures: [] })
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

describe('runMainGuard — gates de saúde do merge', () => {
  const GATES_TITLE = `Merge sem gates: #7 (${SHA.slice(0, 7)})`
  const run = (overrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const api = makeApi(overrides)
    return runMainGuard(event(), api, { ...opts, ...extra }).then((result) => ({ api, result }))
  }
  const missingOf = (result: { gateFailures: { missing: string[] }[] }) =>
    result.gateFailures[0]?.missing

  it('ok com checks success, UAT aprovado e 1 pai', async () => {
    const { api, result } = await run()
    expect(result).toEqual({ ok: true, offending: [], gateFailures: [] })
    expect(api.createIssue).not.toHaveBeenCalled()
    expect(api.checkRuns).toHaveBeenCalledWith(HEAD)
    expect(api.commitParents).toHaveBeenCalledWith(SHA)
  })

  it('check ausente alarma e abre issue merge-sem-gates', async () => {
    const { api, result } = await run({
      checkRuns: vi.fn(async () => runs(['Test & Lint (root)', 'Walking Skeleton (example)'])),
    })
    expect(result.ok).toBe(false)
    expect(result.gateFailures[0]).toMatchObject({ pr: 7, sha: SHA })
    expect(missingOf(result)).toContain('check "PR gate" ausente')
    expect(api.createIssue).toHaveBeenCalledWith(
      GATES_TITLE,
      expect.stringContaining('check "PR gate" ausente'),
      'merge-sem-gates'
    )
  })

  it.each(['failure', 'skipped', 'cancelled'])('conclusão %s alarma', async (conclusion) => {
    const { result } = await run({
      checkRuns: vi.fn(async () => [
        ...runs(['PR gate'], conclusion),
        ...runs(REQUIRED.slice(0, 2)),
      ]),
    })
    expect(missingOf(result)).toEqual([`check "PR gate" com conclusão ${conclusion}`])
  })

  it('check não concluído reporta o status', async () => {
    const { result } = await run({
      checkRuns: vi.fn(async () => [
        ...runs(['PR gate'], null, 'in_progress'),
        ...runs(REQUIRED.slice(0, 2)),
      ]),
    })
    expect(missingOf(result)).toEqual(['check "PR gate" com conclusão in_progress'])
  })

  it('Spec × código ausente: ok com specGate false, alarme com true', async () => {
    const off = await run()
    expect(off.result.ok).toBe(true)
    const on = await run({}, { specGate: true })
    expect(on.result.ok).toBe(false)
    expect(missingOf(on.result)).toEqual(['check "Spec × código" ausente'])
    expect(on.api.createIssue).toHaveBeenCalledWith(
      GATES_TITLE,
      expect.stringContaining('SPEC_GATE'),
      'merge-sem-gates'
    )
  })

  it.each([
    ['UAT não marcado', '- [ ] UAT aprovado\n- [ ] UAT não se aplica — '],
    ['UAT "não se aplica" sem motivo', '- [ ] UAT aprovado\n- [x] UAT não se aplica — '],
    ['duas opções de UAT marcadas', '- [x] UAT aprovado\n- [x] UAT não se aplica — só docs'],
    ['UAT não marcado', 'sem seção de uat'],
  ])('%s alarma', async (message, body) => {
    const { result } = await run({ pullsForCommit: vi.fn(async () => [merged('main', body)]) })
    expect(missingOf(result)).toEqual([message])
  })

  it('UAT "não se aplica" com motivo é ok', async () => {
    const body = '- [ ] UAT aprovado\n- [x] UAT não se aplica — só docs'
    const { result } = await run({ pullsForCommit: vi.fn(async () => [merged('main', body)]) })
    expect(result.ok).toBe(true)
  })

  it('merge commit (2 pais) alarma', async () => {
    const { result } = await run({ commitParents: vi.fn(async () => ['1', '2']) })
    expect(missingOf(result)).toEqual(['merge commit (2 pais): use squash'])
  })

  it('issue merge-sem-gates aberta recebe comentário', async () => {
    const { api } = await run({
      checkRuns: vi.fn(async () => []),
      findOpenIssue: vi.fn(async (label: string) => (label === 'merge-sem-gates' ? 9 : null)),
    })
    expect(api.comment).toHaveBeenCalledWith(9, expect.stringContaining('PR #7'))
    expect(api.createIssue).not.toHaveBeenCalled()
  })

  it('PR com vários commits é avaliado uma vez', async () => {
    const { api, result } = await run({ compare: vi.fn(async () => [SHA, AFTER]) })
    expect(result.ok).toBe(true)
    expect(api.checkRuns).toHaveBeenCalledTimes(1)
  })

  it('re-lê os checks: check que chega na 2ª tentativa é ok', async () => {
    const checkRuns = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(runs())
    const { result } = await run({ checkRuns })
    expect(result.ok).toBe(true)
    expect(checkRuns).toHaveBeenCalledTimes(2)
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
    expect(result).toEqual({ ok: false, offending: [AFTER], gateFailures: [] })
    const post = fetchFn.mock.calls.find(([u]) => u.endsWith('/issues'))
    expect(String(post?.[1].body)).toContain('compare retornou')
  })

  it('total_commits ausente é fail-closed', async () => {
    const { fetchFn } = makeFetch((url) =>
      url.includes('/compare/') ? json({ commits: [{ sha: SHA }] }) : json([])
    )
    const result = await runMainGuard(event(), githubApi(fetchFn), opts)
    expect(result).toEqual({ ok: false, offending: [AFTER], gateFailures: [] })
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

describe('config e workflows', () => {
  const config = JSON.parse(readFileSync(resolve(ROOT, 'hooks/protect-main/config.json'), 'utf8'))
  const workflowsDir = resolve(ROOT, '.github/workflows')
  const jobNames = readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml'))
    .flatMap((file) =>
      [...readFileSync(resolve(workflowsDir, file), 'utf8').matchAll(/^ {4}name:\s*(.+)$/gm)].map(
        (match) => match[1].trim().replace(/^['"]|['"]$/g, '')
      )
    )

  it('requiredChecks são nomes de job dos workflows', () => {
    for (const name of config.requiredChecks) expect(jobNames).toContain(name)
  })

  it('specGateCheck é nome de job de um workflow', () =>
    expect(jobNames).toContain(config.specGateCheck))

  it('main-guard.yml tem checks: read e SPEC_GATE', () => {
    const yml = readFileSync(resolve(workflowsDir, 'main-guard.yml'), 'utf8')
    expect(yml).toMatch(/^\s+checks:\s*read\s*$/m)
    expect(yml).toContain('SPEC_GATE: ${{ vars.SPEC_GATE }}')
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
