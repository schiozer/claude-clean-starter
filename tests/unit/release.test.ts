import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  bumpType,
  buildReleaseNotes,
  makeReleaseApi,
  nextVersion,
  runRelease,
} from '../../scripts/release.mjs'

const ROOT = resolve(__dirname, '../..')
const AFTER = 'a'.repeat(40)
const BEFORE = 'b'.repeat(40)
const ZEROS = '0'.repeat(40)
const SPEC_BODY = 'Spec: docs/superpowers/specs/x.md\n\n- [x] UAT aprovado\n'

const change = (title: string, body = '') => ({ title, body })

describe('bumpType', () => {
  it('feat é minor, fix é patch, ! e BREAKING CHANGE são major', () => {
    expect(bumpType('feat(a): x', '')).toBe('minor')
    expect(bumpType('fix(a): x', '')).toBe('patch')
    expect(bumpType('feat(a)!: x', '')).toBe('major')
    expect(bumpType('fix: x', 'BREAKING CHANGE: y')).toBe('major')
    expect(bumpType('título inválido', '')).toBe('patch')
  })
})

describe('nextVersion', () => {
  it('sem tags usa a versão do package.json', () => {
    expect(nextVersion([], change('feat: x'), '0.1.0')).toBe('0.1.0')
  })
  it('aplica o bump sobre a maior tag', () => {
    expect(nextVersion(['v0.1.0'], change('fix: x'), '0.1.0')).toBe('0.1.1')
    expect(nextVersion(['v0.1.0'], change('feat: x'), '0.1.0')).toBe('0.2.0')
    expect(nextVersion(['v0.1.0'], change('feat!: x'), '0.1.0')).toBe('1.0.0')
    expect(nextVersion(['v0.4.2'], change('fix: x', 'BREAKING CHANGE: x'), '0.1.0')).toBe('1.0.0')
  })
  it('compara numericamente', () => {
    expect(nextVersion(['v0.9.0', 'v0.10.0'], change('fix: x'), '0.1.0')).toBe('0.10.1')
  })
  it('ignora tags fora de vX.Y.Z', () => {
    const tags = ['v1.2', 'v1.2.3-rc.1', 'release-1', 'v0.3.0']
    expect(nextVersion(tags, change('fix: x'), '0.1.0')).toBe('0.3.1')
  })
})

describe('buildReleaseNotes', () => {
  const base = {
    title: 'feat(a): algo',
    prNumber: 12,
    prUrl: 'https://github.com/o/r/pull/12',
    body: SPEC_BODY,
    specGate: 'ok' as const,
    commits: [AFTER],
  }
  it('inclui PR, spec, spec × código e UAT', () => {
    const notes = buildReleaseNotes(base)
    expect(notes).toContain('#12')
    expect(notes).toContain('https://github.com/o/r/pull/12')
    expect(notes).toContain('docs/superpowers/specs/x.md')
    expect(notes).toContain('Spec × código: ok')
    expect(notes).toContain('UAT: aprovado')
    expect(notes).not.toContain('### Commits')
  })
  it('lista commits quando há mais de um', () => {
    const notes = buildReleaseNotes({ ...base, commits: [BEFORE, AFTER] })
    expect(notes).toContain(BEFORE)
    expect(notes).toContain(AFTER)
  })
  it('spec n/a mostra o motivo; UAT n.a. e não marcado', () => {
    expect(buildReleaseNotes({ ...base, body: 'Spec: n/a — só docs' })).toContain('n/a — só docs')
    expect(buildReleaseNotes({ ...base, body: 'Spec: n/a — x' })).toContain('UAT: não marcado')
    expect(
      buildReleaseNotes({ ...base, body: '- [x] UAT não se aplica — sem UI\nSpec: n/a — x' })
    ).toContain('UAT: n.a. — sem UI')
  })
})

type Mocked = ReturnType<typeof vi.fn>
const makeApi = (overrides: Record<string, unknown> = {}) => ({
  tags: vi.fn(async () => [{ name: 'v0.1.0', sha: 'c'.repeat(40) }]),
  pullsForCommit: vi.fn(async () => [
    {
      number: 12,
      html_url: 'https://github.com/o/r/pull/12',
      title: 'feat(a): algo',
      body: SPEC_BODY,
      merged_at: '2026-10-25T00:00:00Z',
      base: { ref: 'main' },
      head: { sha: 'd'.repeat(40) },
    },
  ]),
  commitMessage: vi.fn(async () => 'fix(b): direto\n\ncorpo'),
  compare: vi.fn(async () => [BEFORE, AFTER]),
  checkRuns: vi.fn(async () => [
    { name: 'Spec × código', status: 'completed', conclusion: 'success' },
  ]),
  createTag: vi.fn() as Mocked,
  createRelease: vi.fn() as Mocked,
  ...overrides,
})

const opts = { packageVersion: '0.1.0' }

describe('runRelease', () => {
  it('é idempotente quando uma tag já aponta para after', async () => {
    const api = makeApi({ tags: vi.fn(async () => [{ name: 'v0.2.0', sha: AFTER }]) })
    const result = await runRelease({ before: BEFORE, after: AFTER }, api, opts)
    expect(result).toEqual({ created: false, tag: 'v0.2.0' })
    expect(api.createTag).not.toHaveBeenCalled()
    expect(api.createRelease).not.toHaveBeenCalled()
  })
  it('cria tag e release a partir do PR mergeado', async () => {
    const api = makeApi()
    const result = await runRelease({ before: BEFORE, after: AFTER }, api, opts)
    expect(result).toEqual({ created: true, tag: 'v0.2.0' })
    expect(api.createTag).toHaveBeenCalledWith('v0.2.0', AFTER, 'feat(a): algo')
    const [tag, name, notes] = api.createRelease.mock.calls[0]
    expect(tag).toBe('v0.2.0')
    expect(name).toBe('v0.2.0 — feat(a): algo')
    expect(notes).toContain('Spec × código: ok')
    expect(api.checkRuns).toHaveBeenCalledWith('d'.repeat(40))
  })
  it('sem PR usa a primeira linha do commit e Spec × código pulado', async () => {
    const api = makeApi({ pullsForCommit: vi.fn(async () => []) })
    await runRelease({ before: ZEROS, after: AFTER }, api, opts)
    expect(api.createTag).toHaveBeenCalledWith('v0.1.1', AFTER, 'fix(b): direto')
    expect(api.compare).not.toHaveBeenCalled()
    expect(api.createRelease.mock.calls[0][2]).toContain('Spec × código: pulado')
  })
  it('Spec × código ausente nos checks vira pulado; falha vira vermelho', async () => {
    const missing = makeApi({ checkRuns: vi.fn(async () => []) })
    await runRelease({ before: BEFORE, after: AFTER }, missing, opts)
    expect(missing.createRelease.mock.calls[0][2]).toContain('Spec × código: pulado')
    const red = makeApi({
      checkRuns: vi.fn(async () => [
        { name: 'Spec × código', status: 'completed', conclusion: 'failure' },
      ]),
    })
    await runRelease({ before: BEFORE, after: AFTER }, red, opts)
    expect(red.createRelease.mock.calls[0][2]).toContain('Spec × código: vermelho')
  })
  it('propaga o erro se o release falhar depois da tag', async () => {
    const api = makeApi({
      createRelease: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    await expect(runRelease({ before: BEFORE, after: AFTER }, api, opts)).rejects.toThrow('boom')
    expect(api.createTag).toHaveBeenCalled()
  })
})

describe('makeReleaseApi', () => {
  it('createTag faz POST git/tags e depois git/refs; tags pagina', async () => {
    const calls: { method: string; url: string; body?: string }[] = []
    const fetchFn = (async (url: string, init: { method: string; body?: string }) => {
      calls.push({ method: init.method, url, body: init.body })
      const body = url.includes('/tags?')
        ? [{ name: 'v1.0.0', commit: { sha: 'e'.repeat(40) } }]
        : {}
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
    const api = makeReleaseApi({ token: 't', repository: 'o/r', fetchFn })
    expect(await api.tags()).toEqual([{ name: 'v1.0.0', sha: 'e'.repeat(40) }])
    await api.createTag('v1.0.1', AFTER, 'msg')
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/o/r/git/tags',
      'https://api.github.com/repos/o/r/git/refs',
    ])
    expect(JSON.parse(posts[0].body!)).toMatchObject({
      tag: 'v1.0.1',
      object: AFTER,
      type: 'commit',
    })
    expect(JSON.parse(posts[1].body!)).toEqual({ ref: 'refs/tags/v1.0.1', sha: AFTER })
    expect(calls[0].url).toContain('per_page=100')
  })
})

describe('workflow release.yml', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf8')
  it.each([
    'branches: [main]',
    'contents: write',
    'pull-requests: read',
    'checks: read',
    'group: release',
    'cancel-in-progress: false',
    'node scripts/release.mjs',
  ])('contém %s', (snippet) => {
    expect(workflow).toContain(snippet)
  })
})
