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
  pendingPollMs: 0,
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

  it.each([
    ['novo primeiro', 'success', 20, 'failure', 10],
    ['velho primeiro', 'failure', 10, 'success', 20],
  ])('usa o run mais recente por id (%s)', async (_name, c1, id1, c2, id2) => {
    const { result } = await run({
      checkRuns: vi.fn(async () => [
        { name: 'PR gate', status: 'completed', conclusion: c1, id: id1 },
        { name: 'PR gate', status: 'completed', conclusion: c2, id: id2 },
        ...runs(REQUIRED.slice(0, 2)),
      ]),
    })
    expect(result.ok).toBe(true)
  })

  it('espera check pendente: in_progress na 1ª leitura e success na 2ª → ok', async () => {
    const checkRuns = vi
      .fn()
      .mockResolvedValueOnce([
        ...runs(['PR gate'], null, 'in_progress'),
        ...runs(REQUIRED.slice(0, 2)),
      ])
      .mockResolvedValueOnce(runs())
    const { api, result } = await run({ checkRuns }, { retries: 1 })
    expect(result.ok).toBe(true)
    expect(checkRuns).toHaveBeenCalledTimes(2)
    expect(api.createIssue).not.toHaveBeenCalled()
  })

  it('check sempre pendente alarma ao esgotar o orçamento de espera', async () => {
    const checkRuns = vi.fn(async () => [
      ...runs(['PR gate'], null, 'queued'),
      ...runs(REQUIRED.slice(0, 2)),
    ])
    const { api, result } = await run({ checkRuns }, { pendingMaxPolls: 4 })
    expect(missingOf(result)).toEqual(['check "PR gate" com conclusão queued'])
    expect(checkRuns).toHaveBeenCalledTimes(5)
    expect(api.createIssue).toHaveBeenCalled()
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

describe('runMainGuard — esteira (guarda por branch)', () => {
  const ESTEIRA = {
    integracao: 'develop',
    producao: 'main',
    prefixoHotfix: 'hotfix/',
    promotores: ['alguem'],
  }
  const APP = 'esteira-promover[bot]'
  const NA = '- [ ] UAT aprovado\n- [x] UAT não se aplica — hotfix urgente'
  const pr = (base: string, headRef: string, body = UAT_OK) => ({
    ...merged(base, body),
    head: { sha: HEAD, ref: headRef },
  })
  const esteiraOpts = { ...opts, protectedBranches: ['main'], esteira: ESTEIRA }
  const deploymentOk = (sha = AFTER) => ({
    deployments: vi.fn(async () => [{ id: 11, payload: { sha }, creator: { login: APP } }]),
    deploymentOk: vi.fn(async () => true),
    compareStatus: vi.fn(async () => ({ status: 'behind', aheadBy: 0, behindBy: 0 })),
    // commits da develop: PR mergeado com base develop, não main.
    pullsForCommit: vi.fn(async () => [pr('develop', 'feature/x')]),
  })
  const promocao = (extra = {}) => event({ sender: { login: APP }, ...extra })

  describe('CT-ESTEIRA-004 — FF da produção pela App', () => {
    it('FF da App com Deployment production ok → ok, sem issue', async () => {
      const api = makeApi(deploymentOk())
      const result = await runMainGuard(promocao(), api, esteiraOpts)
      expect(result).toEqual({ ok: true, offending: [], gateFailures: [] })
      expect(api.deployments).toHaveBeenCalledWith(AFTER, 'production')
      expect(api.deploymentOk).toHaveBeenCalledWith(11)
      expect(api.compareStatus).toHaveBeenCalledWith(AFTER, 'develop')
      expect(api.createIssue).not.toHaveBeenCalled()
    })

    it('mesmo push com sender humano → alarme', async () => {
      const api = makeApi(deploymentOk())
      const result = await runMainGuard(event({ sender: { login: 'fulano' } }), api, esteiraOpts)
      expect(result.ok).toBe(false)
      expect(result.offending).toEqual([SHA])
      expect(api.deployments).not.toHaveBeenCalled()
      expect(api.createIssue).toHaveBeenCalled()
    })

    it('Deployment com payload.sha diferente → alarme com motivo', async () => {
      const api = makeApi(deploymentOk('e'.repeat(40)))
      const result = await runMainGuard(promocao(), api, esteiraOpts)
      expect(result).toEqual({ ok: false, offending: [SHA], gateFailures: [] })
      const body = (api.createIssue.mock.calls[0] as unknown as string[])[1]
      expect(body).toContain('Deployment `production` bem-sucedido')
    })

    it('Deployment sem status success → alarme', async () => {
      const api = makeApi({ ...deploymentOk(), deploymentOk: vi.fn(async () => false) })
      expect((await runMainGuard(promocao(), api, esteiraOpts)).ok).toBe(false)
    })

    it('sem Deployment nenhum → alarme', async () => {
      const api = makeApi({ ...deploymentOk(), deployments: vi.fn(async () => []) })
      expect((await runMainGuard(promocao(), api, esteiraOpts)).ok).toBe(false)
    })

    it('after fora da integração (behindBy > 0) → alarme com motivo', async () => {
      const api = makeApi({
        ...deploymentOk(),
        compareStatus: vi.fn(async () => ({ status: 'diverged', aheadBy: 2, behindBy: 1 })),
      })
      const result = await runMainGuard(promocao(), api, esteiraOpts)
      expect(result.ok).toBe(false)
      const body = (api.createIssue.mock.calls[0] as unknown as string[])[1]
      expect(body).toContain('não é alcançável pela `develop`')
    })

    it('forced da App → alarme sem consultar deployments', async () => {
      const api = makeApi(deploymentOk())
      const result = await runMainGuard(promocao({ forced: true }), api, esteiraOpts)
      expect(result.ok).toBe(false)
      expect(api.deployments).not.toHaveBeenCalled()
    })

    it('sender da App sem esteira → regras atuais (alarma sem PR na main)', async () => {
      const api = makeApi(deploymentOk())
      const result = await runMainGuard(promocao(), api, { ...opts, esteira: null })
      expect(result.ok).toBe(false)
      expect(api.deployments).not.toHaveBeenCalled()
    })
  })

  describe('PR na produção com esteira', () => {
    it('PR feature/x mergeado na main → gate failure "base main exige hotfix/*"', async () => {
      const api = makeApi({ pullsForCommit: vi.fn(async () => [pr('main', 'feature/x', NA)]) })
      const result = await runMainGuard(event(), api, esteiraOpts)
      expect(result.ok).toBe(false)
      expect(result.gateFailures[0].missing).toContain('base main exige hotfix/*')
    })

    it('PR hotfix/x com "UAT não se aplica" → ok', async () => {
      const api = makeApi({ pullsForCommit: vi.fn(async () => [pr('main', 'hotfix/x', NA)]) })
      const result = await runMainGuard(event(), api, esteiraOpts)
      expect(result).toEqual({ ok: true, offending: [], gateFailures: [] })
    })

    it('sem esteira, PR feature/x na main segue ok como hoje', async () => {
      const api = makeApi({ pullsForCommit: vi.fn(async () => [pr('main', 'feature/x')]) })
      const result = await runMainGuard(event(), api, { ...opts, esteira: null })
      expect(result.ok).toBe(true)
    })
  })

  describe('CT-ESTEIRA-005 — integração', () => {
    const naDevelop = (extra = {}) => event({ ref: 'refs/heads/develop', ...extra })
    const twoParents = vi.fn(async () => ['p'.repeat(40), 'q'.repeat(40)])

    it('develop é protegida com esteira (push sem PR alarma)', async () => {
      const api = makeApi({ pullsForCommit: vi.fn(async () => []) })
      const result = await runMainGuard(naDevelop(), api, esteiraOpts)
      expect(result.ok).toBe(false)
      expect(api.createIssue).toHaveBeenCalledWith(
        `Commit na develop sem PR: ${AFTER.slice(0, 7)}`,
        expect.stringContaining('Chegaram à `develop`'),
        'main-sem-pr'
      )
    })

    it('sem esteira, push na develop é ignorado', async () => {
      const api = makeApi()
      const result = await runMainGuard(naDevelop(), api, { ...opts, esteira: null })
      expect(result.ok).toBe(true)
      expect(api.compare).not.toHaveBeenCalled()
    })

    it('PR feature squash na develop sem UAT marcado → ok', async () => {
      const api = makeApi({
        pullsForCommit: vi.fn(async () => [pr('develop', 'feature/x', 'sem seção de UAT')]),
      })
      const result = await runMainGuard(naDevelop(), api, esteiraOpts)
      expect(result).toEqual({ ok: true, offending: [], gateFailures: [] })
    })

    it('merge commit na develop de PR feature → alarme', async () => {
      const api = makeApi({
        pullsForCommit: vi.fn(async () => [pr('develop', 'feature/x')]),
        commitParents: twoParents,
      })
      const result = await runMainGuard(naDevelop(), api, esteiraOpts)
      expect(result.ok).toBe(false)
      expect(result.gateFailures[0].missing).toContain('merge commit (2 pais): use squash')
    })

    it('merge commit na develop de PR back-promotion → ok', async () => {
      const api = makeApi({
        pullsForCommit: vi.fn(async () => [pr('develop', 'main')]),
        commitParents: twoParents,
      })
      const result = await runMainGuard(naDevelop(), api, esteiraOpts)
      expect(result).toEqual({ ok: true, offending: [], gateFailures: [] })
    })

    it('back-promotion mergeada por squash (1 pai) → alarme', async () => {
      const api = makeApi({ pullsForCommit: vi.fn(async () => [pr('develop', 'main')]) })
      const result = await runMainGuard(naDevelop(), api, esteiraOpts)
      expect(result.ok).toBe(false)
      expect(result.gateFailures[0].missing[0]).toContain('Create a merge commit')
    })

    it('back-promotion: commits trazidos da main (PR base main) são aceitos', async () => {
      const MERGE = 'm'.repeat(40)
      const HOTFIX = 'h'.repeat(40)
      const api = makeApi({
        compare: vi.fn(async () => [HOTFIX, MERGE]),
        pullsForCommit: vi.fn(async (sha: string) =>
          sha === MERGE ? [pr('develop', 'main')] : [pr('main', 'hotfix/x', NA)]
        ),
        commitParents: twoParents,
        compareStatus: vi.fn(async () => ({ status: 'behind', aheadBy: 0, behindBy: 0 })),
      })
      const result = await runMainGuard(naDevelop(), api, esteiraOpts)
      expect(result).toEqual({ ok: true, offending: [], gateFailures: [] })
      expect(api.compareStatus).toHaveBeenCalledWith(HOTFIX, 'main')
    })

    it('commit fora da main sem PR na develop, mesmo com back-promotion → alarme', async () => {
      const MERGE = 'm'.repeat(40)
      const SOLTO = 's'.repeat(40)
      const api = makeApi({
        compare: vi.fn(async () => [SOLTO, MERGE]),
        pullsForCommit: vi.fn(async (sha: string) =>
          sha === MERGE ? [pr('develop', 'main')] : []
        ),
        commitParents: twoParents,
        compareStatus: vi.fn(async () => ({ status: 'diverged', aheadBy: 1, behindBy: 1 })),
      })
      const result = await runMainGuard(naDevelop(), api, esteiraOpts)
      expect(result.offending).toEqual([SOLTO])
    })
  })
})

describe('makeGithubApi — esteira', () => {
  it('compareStatus lê status, ahead_by e behind_by', async () => {
    const { fetchFn, calls } = makeFetch(() =>
      json({ status: 'behind', ahead_by: 0, behind_by: 3, total_commits: 0, commits: [] })
    )
    expect(await githubApi(fetchFn).compareStatus(AFTER, 'develop')).toEqual({
      status: 'behind',
      aheadBy: 0,
      behindBy: 3,
    })
    expect(calls[0].url).toBe(`https://gh.test/repos/o/r/compare/${AFTER}...develop?per_page=1`)
  })

  it('compareStatus sem behind_by numérico lança', async () => {
    const { fetchFn } = makeFetch(() => json({ status: 'behind' }))
    await expect(githubApi(fetchFn).compareStatus(AFTER, 'develop')).rejects.toThrow(/behind_by/)
  })

  it('deployments filtra por sha e environment e normaliza payload texto', async () => {
    const { fetchFn, calls } = makeFetch(() =>
      json([
        { id: 1, payload: { sha: AFTER }, creator: { login: 'x' } },
        { id: 2, payload: JSON.stringify({ sha: AFTER }), creator: { login: 'y' } },
      ])
    )
    const list = await githubApi(fetchFn).deployments(AFTER, 'production')
    expect(list).toEqual([
      { id: 1, payload: { sha: AFTER }, creator: { login: 'x' } },
      { id: 2, payload: { sha: AFTER }, creator: { login: 'y' } },
    ])
    expect(calls[0].url).toBe(
      `https://gh.test/repos/o/r/deployments?sha=${AFTER}&environment=production&per_page=100`
    )
  })

  it('deploymentOk: o status mais recente decide', async () => {
    const ok = makeFetch(() =>
      json([
        { id: 9, state: 'success' },
        { id: 5, state: 'in_progress' },
      ])
    )
    expect(await githubApi(ok.fetchFn).deploymentOk(11)).toBe(true)
    expect(ok.calls[0].url).toBe('https://gh.test/repos/o/r/deployments/11/statuses?per_page=100')
    const falhou = makeFetch(() =>
      json([
        { id: 5, state: 'success' },
        { id: 9, state: 'failure' },
      ])
    )
    expect(await githubApi(falhou.fetchFn).deploymentOk(11)).toBe(false)
    const vazio = makeFetch(() => json([]))
    expect(await githubApi(vazio.fetchFn).deploymentOk(11)).toBe(false)
  })
})

describe('workflow main-guard.yml — esteira', () => {
  const yml = readFileSync(resolve(ROOT, '.github/workflows/main-guard.yml'), 'utf8')
  it('dispara em push para main e develop', () =>
    expect(yml).toMatch(/^\s*branches:\s*\[main,\s*develop\]/m))
  it('tem permissions.deployments: read', () => expect(yml).toMatch(/^\s+deployments:\s*read\s*$/m))
})
