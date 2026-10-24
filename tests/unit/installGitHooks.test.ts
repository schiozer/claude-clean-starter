import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installGitHooks } from '../../scripts/install-git-hooks.mjs'

const ROOT = resolve(__dirname, '../..')
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: ENV, encoding: 'utf8' })

describe('installGitHooks (git real)', { timeout: 30000 }, () => {
  let tmp: string
  let repo: string
  const original = { ...process.env }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'install-hooks-'))
    repo = join(tmp, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    // isola de config global/sistema do desenvolvedor (ex.: core.hooksPath global)
    process.env.GIT_CONFIG_GLOBAL = '/dev/null'
    process.env.GIT_CONFIG_NOSYSTEM = '1'
  })

  afterEach(() => {
    process.env = { ...original }
    rmSync(tmp, { recursive: true, force: true })
  })

  const hooksPath = () => git(repo, 'config', '--get', 'core.hooksPath').trim()

  it('fora de repositório git → skipped', () => {
    const outside = mkdtempSync(join(tmpdir(), 'no-git-'))
    try {
      expect(installGitHooks(outside)).toEqual({ action: 'skipped', previous: null })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('raiz do git diferente do diretório → skipped e não grava config', () => {
    const sub = join(repo, 'pkg')
    mkdirSync(sub)
    expect(installGitHooks(sub)).toEqual({ action: 'skipped', previous: null })
    expect(
      spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo, env: ENV }).status
    ).toBe(1)
  })

  it('core.hooksPath ausente → installed', () => {
    expect(installGitHooks(repo)).toEqual({ action: 'installed', previous: null })
    expect(hooksPath()).toBe('.githooks')
  })

  it('já .githooks → unchanged', () => {
    git(repo, 'config', 'core.hooksPath', '.githooks')
    expect(installGitHooks(repo)).toEqual({ action: 'unchanged', previous: null })
    expect(hooksPath()).toBe('.githooks')
  })

  it('.husky → replaced, guarda o valor anterior', () => {
    git(repo, 'config', 'core.hooksPath', '.husky')
    expect(installGitHooks(repo)).toEqual({ action: 'replaced', previous: '.husky' })
    expect(hooksPath()).toBe('.githooks')
  })

  it('restaura o bit executável dos shims', () => {
    mkdirSync(join(repo, '.githooks'))
    for (const shim of ['reference-transaction', 'pre-push']) {
      const file = join(repo, '.githooks', shim)
      writeFileSync(file, '#!/bin/sh\n')
      chmodSync(file, 0o644)
    }
    installGitHooks(repo)
    for (const shim of ['reference-transaction', 'pre-push']) {
      expect(statSync(join(repo, '.githooks', shim)).mode & 0o111).toBe(0o111)
    }
  })

  it('CLI imprime a ação e avisa no stderr em replaced', () => {
    mkdirSync(join(repo, 'scripts'))
    cpSync(join(ROOT, 'scripts/install-git-hooks.mjs'), join(repo, 'scripts/install-git-hooks.mjs'))
    git(repo, 'config', 'core.hooksPath', '.husky')
    const first = spawnSync('node', ['scripts/install-git-hooks.mjs'], {
      cwd: repo,
      env: ENV,
      encoding: 'utf8',
    })
    expect(first.status).toBe(0)
    expect(first.stdout.trim()).toBe('replaced')
    expect(first.stderr).toContain('.githooks/')
    const second = spawnSync('node', ['scripts/install-git-hooks.mjs'], {
      cwd: repo,
      env: ENV,
      encoding: 'utf8',
    })
    expect(second.stdout.trim()).toBe('unchanged')
    expect(second.stderr).toBe('')
  })

  it('package.json tem prepare exato e os shims estão 100755 no índice', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts.prepare).toBe('node scripts/install-git-hooks.mjs')
    const staged = execFileSync('git', ['ls-files', '-s', '.githooks'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    const lines = staged.trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line.startsWith('100755')).toBe(true)
  })
})
