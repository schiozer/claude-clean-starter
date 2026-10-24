import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runMainGuard } from '../../scripts/main-guard.mjs'

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

const opts = { retries: 3, delayMs: 0 }

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
