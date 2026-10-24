import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BLOCK_PREFIX } from '../../hooks/protect-main/evaluate.mjs'

const ROOT = resolve(__dirname, '../..')
const RUN = join(ROOT, 'hooks/protect-main/run.mjs')

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })

const runHook = (payload: string) => {
  const result = spawnSync('node', [RUN], { input: payload, encoding: 'utf8' })
  return { status: result.status, stderr: result.stderr }
}

const payloadFor = (command: string, cwd: string) =>
  JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd })

describe('protect-main run.mjs', () => {
  let tmp: string
  let repo: string

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'protect-main-')))
    repo = join(tmp, 'repo')
    execFileSync('git', ['init', '-q', '-b', 'main', repo])
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  const commitInitial = () => git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')

  it('should block commit on main', () => {
    commitInitial()
    const { status, stderr } = runHook(payloadFor('git commit -m x', repo))
    expect(status).toBe(2)
    expect(stderr).toContain(BLOCK_PREFIX)
  })

  it('should block commit on main in a repo without commits', () => {
    const { status } = runHook(payloadFor('git commit -m x', repo))
    expect(status).toBe(2)
  })

  it('should allow commit on feature branch', () => {
    commitInitial()
    git(repo, 'switch', '-q', '-c', 'feat/x')
    const { status } = runHook(payloadFor('git commit -m x', repo))
    expect(status).toBe(0)
  })

  it('should allow commit inside a feature worktree', () => {
    commitInitial()
    const wt = join(tmp, 'wt')
    git(repo, 'worktree', 'add', '-q', wt, '-b', 'feat/wt')
    const { status } = runHook(payloadFor('git commit -m x', wt))
    expect(status).toBe(0)
  })

  it('should allow non-Bash tools and payloads without command', () => {
    expect(runHook(JSON.stringify({ tool_name: 'Read', tool_input: {} })).status).toBe(0)
    expect(runHook(JSON.stringify({ tool_name: 'Bash', tool_input: {} })).status).toBe(0)
  })

  it('should fail closed on invalid payload mentioning git', () => {
    const { status, stderr } = runHook('not json git push')
    expect(status).toBe(2)
    expect(stderr).toContain(BLOCK_PREFIX)
  })

  it('should fail open on invalid payload without git', () => {
    const { status, stderr } = runHook('not json')
    expect(status).toBe(0)
    expect(stderr).not.toBe('')
  })

  it('settings.json registers the hook and the deny rule', () => {
    const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'))
    const entry = settings.hooks.PreToolUse[0]
    expect(entry.matcher).toBe('Bash')
    expect(entry.hooks[0].command).toContain('hooks/protect-main/run.mjs')
    expect(settings.permissions.deny).toContain('Bash(gh pr merge *)')
  })

  it('config.json has protectedBranches and no enabled key', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'hooks/protect-main/config.json'), 'utf8'))
    expect(config.protectedBranches).toContain('main')
    expect(config).not.toHaveProperty('enabled')
  })
})
