import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkPrePush, checkRefTransaction } from '../../hooks/protect-main/git-guard.mjs'
import { BLOCK_PREFIX } from '../../hooks/protect-main/evaluate.mjs'

const ROOT = resolve(__dirname, '../..')
const CONFIG = join(ROOT, 'hooks/protect-main/config.json')
const SHIMS = ['reference-transaction', 'pre-push']
const shimPath = (hook: string) => join(ROOT, '.githooks', hook)
const FINAL_LINE = 'Atualizar a `main` local com `git pull` continua permitido.'

const ZERO = '0'.repeat(40)
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)

type RefUpdate = { oldSha: string; newSha: string; ref: string }

const refTx = (
  lines: RefUpdate[],
  origin: Record<string, string>,
  protectedBranches = ['main'],
  local: Record<string, string> = {}
) =>
  checkRefTransaction(lines, {
    protectedBranches,
    originSha: (branch: string) => origin[branch] ?? null,
    localSha: (branch: string) => local[branch] ?? null,
  })

const push = (remoteRef: string, localSha = C) => ({
  localRef: localSha === ZERO ? '(delete)' : 'refs/heads/feat/x',
  localSha,
  remoteRef,
  remoteSha: B,
})

describe('git-guard checkRefTransaction', () => {
  it.each([
    [
      'update main to a local commit',
      [{ oldSha: A, newSha: C, ref: 'refs/heads/main' }],
      { main: B },
    ],
    [
      'create main away from origin',
      [{ oldSha: ZERO, newSha: C, ref: 'refs/heads/main' }],
      { main: B },
    ],
  ])('should refuse: %s', (_name, lines, origin) => {
    const reason = refTx(lines, origin)
    expect(reason?.startsWith(BLOCK_PREFIX)).toBe(true)
    expect(reason?.endsWith(FINAL_LINE)).toBe(true)
    expect(reason).toMatch(/git pull --ff-only|git reset --hard origin\/main/)
  })

  it('should refuse a rewrite that differs from the current local value', () => {
    const lines = [{ oldSha: ZERO, newSha: C, ref: 'refs/heads/main' }]
    expect(refTx(lines, { main: B }, ['main'], { main: A })).not.toBeNull()
  })

  it('should refuse an extra protected branch', () => {
    const lines = [{ oldSha: A, newSha: C, ref: 'refs/heads/release' }]
    expect(refTx(lines, {}, ['main', 'release'])).not.toBeNull()
  })

  it.each([
    ['fast-forward to origin', [{ oldSha: A, newSha: B, ref: 'refs/heads/main' }], { main: B }],
    ['delete main', [{ oldSha: A, newSha: ZERO, ref: 'refs/heads/main' }], { main: B }],
    ['initial commit without remote', [{ oldSha: ZERO, newSha: C, ref: 'refs/heads/main' }], {}],
    ['feature branch', [{ oldSha: A, newSha: C, ref: 'refs/heads/feat/x' }], { main: B }],
    ['symbolic HEAD', [{ oldSha: A, newSha: C, ref: 'HEAD' }], { main: B }],
    [
      'origin updated in the same transaction (fetch origin main:main)',
      [
        { oldSha: A, newSha: C, ref: 'refs/heads/main' },
        { oldSha: A, newSha: C, ref: 'refs/remotes/origin/main' },
      ],
      { main: A },
    ],
  ])('should allow: %s', (_name, lines, origin) => {
    expect(refTx(lines, origin)).toBeNull()
  })

  it('should allow a no-op rewrite of main (pack-refs, gc) while behind origin', () => {
    const lines = [{ oldSha: ZERO, newSha: A, ref: 'refs/heads/main' }]
    expect(refTx(lines, { main: B }, ['main'], { main: A })).toBeNull()
  })
})

describe('git-guard checkPrePush', () => {
  it.each([
    ['push to main', [push('refs/heads/main')]],
    ['delete main', [push('refs/heads/main', ZERO)]],
    ['mixed batch', [push('refs/heads/feat/x'), push('refs/heads/main')]],
  ])('should refuse: %s', (_name, lines) => {
    const reason = checkPrePush(lines, ['main'])
    expect(reason?.startsWith(BLOCK_PREFIX)).toBe(true)
    expect(reason?.endsWith(FINAL_LINE)).toBe(true)
    expect(reason).toContain('refs/heads/main')
  })

  it('should allow creating main on a remote that does not have it', () => {
    const create = { ...push('refs/heads/main'), remoteSha: ZERO }
    expect(checkPrePush([create], ['main'])).toBeNull()
  })

  it('should refuse deleting main even when the remote sha is zero', () => {
    const del = { ...push('refs/heads/main', ZERO), remoteSha: ZERO }
    expect(checkPrePush([del], ['main'])).not.toBeNull()
  })

  it('should refuse a creation of main mixed with an update of another protected branch', () => {
    const lines = [{ ...push('refs/heads/main'), remoteSha: ZERO }, push('refs/heads/release')]
    expect(checkPrePush(lines, ['main', 'release'])).not.toBeNull()
  })

  it('should allow push of a feature branch', () => {
    expect(checkPrePush([push('refs/heads/feat/x')], ['main'])).toBeNull()
  })
})

describe('git hook shims', () => {
  // O trecho entre os marcadores é o mesmo nos dois shims; roda-o isolado com `sh`.
  const extractionOf = (shim: string) => {
    const text = readFileSync(shimPath(shim), 'utf8')
    const match = text.match(/# >>> extract_protected_branches\n([\s\S]*?)# <<< /)
    if (!match) throw new Error(`marcadores ausentes em ${shim}`)
    return match[1]
  }

  const runExtraction = (shim: string, configPath: string) =>
    execFileSync(
      'sh',
      ['-c', `${extractionOf(shim)}\nextract_protected_branches "$1"`, 'sh', configPath],
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter((line) => line !== '')

  it.each(SHIMS)('should extract the same branches as JSON.parse in %s', (shim) => {
    const expected = JSON.parse(readFileSync(CONFIG, 'utf8')).protectedBranches
    expect(runExtraction(shim, CONFIG)).toEqual(expected)
  })

  it.each(SHIMS)('should extract a multi-line config with several branches in %s', (shim) => {
    const dir = mkdtempSync(join(tmpdir(), 'git-guard-'))
    try {
      const config = join(dir, 'config.json')
      const branches = ['main', 'release/1.x']
      writeFileSync(config, JSON.stringify({ protectedBranches: branches }, null, 2))
      expect(runExtraction(shim, config)).toEqual(branches)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(SHIMS)('should keep the block prefix of evaluate.mjs in %s', (shim) => {
    const text = readFileSync(shimPath(shim), 'utf8')
    expect(text).toContain(BLOCK_PREFIX)
    expect(text).toContain(FINAL_LINE)
  })
})
