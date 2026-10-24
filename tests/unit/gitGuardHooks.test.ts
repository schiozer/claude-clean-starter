import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BLOCK_PREFIX } from '../../hooks/protect-main/evaluate.mjs'

const ROOT = resolve(__dirname, '../..')
const HOOKS_PATH = join(ROOT, '.githooks')

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: ENV, encoding: 'utf8' })

/** Roda um comando sem lançar: status + stderr, para conferir recusas. */
const run = (cwd: string, cmd: string, args: string[], env: NodeJS.ProcessEnv = ENV) => {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env })
  return { status: result.status, stderr: result.stderr }
}
const tryGit = (cwd: string, ...args: string[]) => run(cwd, 'git', args)

const configureUser = (repo: string) => {
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
}

const expectRefused = (result: { status: number | null; stderr: string }) => {
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain(BLOCK_PREFIX)
}
const expectAllowed = (result: { status: number | null; stderr: string }) => {
  expect(result.stderr).not.toContain(BLOCK_PREFIX)
  expect(result.status).toBe(0)
}

// Cada caso cria repositórios e roda hooks reais: mais lento que o padrão de 5 s.
describe('git hooks .githooks (git real)', { timeout: 30000 }, () => {
  let tmp: string
  let bare: string
  let repo: string

  const sha = (ref: string) => git(repo, 'rev-parse', ref).trim()

  // Simula o merge de um PR: um 2º clone, sem hooks, empurra um commit para a main do bare.
  const advanceRemoteMain = () => {
    const other = join(tmp, 'other')
    git(tmp, 'clone', '-q', bare, other)
    configureUser(other)
    git(other, 'commit', '-q', '--allow-empty', '-m', 'merge do PR')
    git(other, 'push', '-q', 'origin', 'main')
  }

  const featWithCommit = () => {
    git(repo, 'switch', '-q', '-c', 'feat')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat')
  }

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'git-guard-')))
    bare = join(tmp, 'remote.git')
    repo = join(tmp, 'repo')
    git(tmp, 'init', '-q', '--bare', '-b', 'main', bare)
    git(tmp, 'clone', '-q', bare, repo)
    configureUser(repo)
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
    git(repo, 'push', '-q', 'origin', 'main')
    git(repo, 'config', 'core.hooksPath', HOOKS_PATH)
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  describe('reference-transaction on main', () => {
    it('should refuse git commit', () => {
      expectRefused(tryGit(repo, 'commit', '--allow-empty', '-m', 'x'))
      expect(sha('main')).toBe(sha('origin/main'))
    })

    it('should refuse git merge of a feature branch', () => {
      featWithCommit()
      git(repo, 'switch', '-q', 'main')
      expectRefused(tryGit(repo, 'merge', '--no-edit', 'feat'))
    })

    it('should refuse git update-ref refs/heads/main', () => {
      featWithCommit()
      expectRefused(tryGit(repo, 'update-ref', 'refs/heads/main', sha('feat')))
    })

    it('should refuse a commit through an alias', () => {
      expectRefused(tryGit(repo, '-c', 'alias.x=commit', 'x', '--allow-empty', '-m', 'y'))
    })

    it('should refuse a commit run from node', () => {
      const script = "require('child_process').execSync('git commit --allow-empty -m z')"
      expectRefused(run(repo, process.execPath, ['-e', script]))
    })

    it('should refuse git branch -f main from a feature branch', () => {
      featWithCommit()
      expectRefused(tryGit(repo, 'branch', '-f', 'main', 'feat'))
    })
  })

  describe('reference-transaction alignment with origin', () => {
    it('should allow git pull on a main that is behind', () => {
      advanceRemoteMain()
      expectAllowed(tryGit(repo, 'pull', '-q'))
      expect(sha('main')).toBe(sha('origin/main'))
    })

    it('should allow git pull with pull.rebase=true', () => {
      advanceRemoteMain()
      expectAllowed(tryGit(repo, '-c', 'pull.rebase=true', 'pull', '-q'))
      expect(sha('main')).toBe(sha('origin/main'))
    })

    it('should allow git reset --hard origin/main', () => {
      advanceRemoteMain()
      git(repo, 'fetch', '-q', 'origin')
      expectAllowed(tryGit(repo, 'reset', '-q', '--hard', 'origin/main'))
    })

    it('should allow git fetch origin main:main from a feature branch', () => {
      featWithCommit()
      advanceRemoteMain()
      expectAllowed(tryGit(repo, 'fetch', '-q', 'origin', 'main:main'))
      expect(sha('main')).toBe(sha('origin/main'))
    })

    it('should allow switching branches', () => {
      expectAllowed(tryGit(repo, 'switch', '-q', '-c', 'feat/y'))
      expectAllowed(tryGit(repo, 'switch', '-q', 'main'))
    })
  })

  describe('reference-transaction in a new repository without remote', () => {
    it('should allow the initial commit and refuse the second one', () => {
      const fresh = join(tmp, 'fresh')
      git(tmp, 'init', '-q', '-b', 'main', fresh)
      configureUser(fresh)
      git(fresh, 'config', 'core.hooksPath', HOOKS_PATH)
      expectAllowed(tryGit(fresh, 'commit', '--allow-empty', '-m', 'init'))
      expectRefused(tryGit(fresh, 'commit', '--allow-empty', '-m', 'second'))
    })
  })

  describe('pre-push from a feature branch', () => {
    beforeEach(featWithCommit)

    it('should allow pushing the feature branch', () => {
      expectAllowed(tryGit(repo, 'push', '-q', 'origin', 'feat'))
    })

    it('should refuse git push origin HEAD:main', () => {
      expectRefused(tryGit(repo, 'push', 'origin', 'HEAD:main'))
    })

    // Com a main local igual à remota o git nem lista `refs/heads/main` no stdin do pre-push;
    // o caso relevante é a main local divergente (criada aqui sem passar pelo hook).
    it.each([
      ['--all', ['push', '--all', 'origin']],
      ['--mirror', ['push', '--mirror', 'origin']],
      ['with push.default=matching', ['-c', 'push.default=matching', 'push', 'origin']],
    ])('should refuse git push %s with a diverging local main', (_name, args) => {
      git(repo, '-c', 'core.hooksPath=/dev/null', 'branch', '-f', 'main', 'feat')
      git(repo, 'push', '-q', 'origin', 'feat')
      expectRefused(tryGit(repo, ...args))
      expect(git(bare, 'rev-parse', 'main')).not.toBe(git(repo, 'rev-parse', 'feat'))
    })
  })

  describe('without node on PATH', () => {
    // Ferramentas que o shim e o git usam; o PATH do teste só tem symlinks para elas, então
    // o resultado não depende de onde o host instala o node (ex.: /usr/bin/node em Linux).
    const SHIM_TOOLS = ['git', 'sh', 'cat', 'basename', 'dirname', 'tr', 'sed']

    const pathWithoutNode = () => {
      const bin = join(tmp, 'bin')
      mkdirSync(bin)
      for (const tool of SHIM_TOOLS) {
        const found = execFileSync('sh', ['-c', 'command -v "$1"', 'sh', tool], {
          encoding: 'utf8',
        })
        symlinkSync(realpathSync(found.trim()), join(bin, tool))
      }
      return { ...ENV, PATH: bin }
    }

    it('should allow a commit on a feature branch', () => {
      git(repo, 'switch', '-q', '-c', 'feat')
      const env = pathWithoutNode()
      expectAllowed(run(repo, 'git', ['commit', '--allow-empty', '-m', 'x'], env))
    })

    it('should refuse a commit on main', () => {
      const env = pathWithoutNode()
      expectRefused(run(repo, 'git', ['commit', '--allow-empty', '-m', 'x'], env))
    })
  })

  describe('shims with several protected branches', () => {
    const ZERO = '0'.repeat(40)
    const A = 'a'.repeat(40)
    const C = 'c'.repeat(40)
    // `sh` e, quando existir, o `dash` (o `sh` de Debian/Ubuntu).
    const SHELLS = ['sh', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])]

    // Cópia do layout `.githooks/` + `hooks/protect-main/` com config de duas branches.
    const layoutWithBranches = (branches: string[]) => {
      const layout = join(tmp, 'layout')
      cpSync(HOOKS_PATH, join(layout, '.githooks'), { recursive: true })
      cpSync(join(ROOT, 'hooks/protect-main'), join(layout, 'hooks/protect-main'), {
        recursive: true,
      })
      writeFileSync(
        join(layout, 'hooks/protect-main/config.json'),
        JSON.stringify({ protectedBranches: branches })
      )
      return join(layout, '.githooks')
    }

    const runShim = (shell: string, shim: string, args: string[], input: string) => {
      const result = spawnSync(shell, [shim, ...args], {
        cwd: repo,
        input,
        encoding: 'utf8',
        env: ENV,
      })
      return { status: result.status, stderr: result.stderr }
    }

    const inputFor = (hook: string, branch: string) =>
      hook === 'pre-push'
        ? `refs/heads/feat ${C} refs/heads/${branch} ${ZERO}\n`
        : `${A} ${C} refs/heads/${branch}\n`
    const argsFor = (hook: string) => (hook === 'pre-push' ? ['origin', 'url'] : ['prepared'])

    const cases = SHELLS.flatMap((shell) =>
      ['reference-transaction', 'pre-push'].flatMap((hook) =>
        ['main', 'release'].map((branch) => [shell, hook, branch])
      )
    )

    it.each(cases)('should refuse under %s in %s for refs/heads/%s', (shell, hook, branch) => {
      const hooks = layoutWithBranches(['main', 'release'])
      expectRefused(runShim(shell, join(hooks, hook), argsFor(hook), inputFor(hook, branch)))
    })

    it.each(SHELLS)('should allow a feature branch line under %s', (shell) => {
      const hooks = layoutWithBranches(['main', 'release'])
      const input = `${A} ${C} refs/heads/feat/x\n`
      expectAllowed(runShim(shell, join(hooks, 'reference-transaction'), ['prepared'], input))
    })
  })
})
