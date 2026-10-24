import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BLOCK_PREFIX } from '../../hooks/protect-main/evaluate.mjs'

const ROOT = resolve(__dirname, '../..')
const RUN = join(ROOT, 'hooks/protect-main/run.mjs')

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: ENV })

const runHook = (payload: string, env: NodeJS.ProcessEnv = ENV) => {
  const result = spawnSync(process.execPath, [RUN], { input: payload, encoding: 'utf8', env })
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
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: ENV })
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

  it('should allow commit on detached HEAD', () => {
    commitInitial()
    git(repo, 'switch', '-q', '--detach')
    expect(runHook(payloadFor('git commit -m x', repo)).status).toBe(0)
  })

  it('should fail closed on git command when git is not available', () => {
    commitInitial()
    const env = { ...ENV, PATH: '/nonexistent' }
    const { status, stderr } = runHook(payloadFor('git commit -m x', repo), env)
    expect(status).toBe(2)
    expect(stderr).toContain(BLOCK_PREFIX)
  })

  it('should allow unrelated command when git is not available', () => {
    const env = { ...ENV, PATH: '/nonexistent' }
    expect(runHook(payloadFor('npm test', repo), env).status).toBe(0)
  })

  it('should allow commit but block push to main outside a git repository', () => {
    const plain = join(tmp, 'plain')
    mkdirSync(plain)
    expect(runHook(payloadFor('git commit -m x', plain)).status).toBe(0)
    expect(runHook(payloadFor('git push origin main', plain)).status).toBe(2)
  })

  it('should resolve $CLAUDE_PROJECT_DIR in cd from the environment', () => {
    commitInitial()
    const wt = join(tmp, 'wt')
    git(repo, 'worktree', 'add', '-q', wt, '-b', 'feat/wt')
    const command = 'cd "$CLAUDE_PROJECT_DIR" && git commit -m x'
    expect(runHook(payloadFor(command, repo), { ...ENV, CLAUDE_PROJECT_DIR: wt }).status).toBe(0)
    expect(runHook(payloadFor(command, wt), { ...ENV, CLAUDE_PROJECT_DIR: repo }).status).toBe(2)
  })

  it('should not depend on the locale of git messages', () => {
    const plain = join(tmp, 'plain')
    mkdirSync(plain)
    const env = { ...ENV, LANG: 'pt_BR.UTF-8', LC_ALL: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' }
    expect(runHook(payloadFor('git commit -m x', plain), env).status).toBe(0)
  })

  it('should block a commit hidden in a command substitution', () => {
    commitInitial()
    expect(runHook(payloadFor('x=$(git commit -m x)', repo)).status).toBe(2)
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
