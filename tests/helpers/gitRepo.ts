// Repositórios git temporários para os testes do template sync.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: GIT_ENV })
    .toString()
    .trim()

export function makeRepo(prefix = 'ts-repo-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'core.hooksPath', '/dev/null')
  return dir
}

/** Grava (string ou Buffer) ou apaga (null) arquivos e faz commit; devolve o sha. */
export function commitFiles(
  dir: string,
  files: Record<string, string | Buffer | null>,
  message = 'commit'
): string {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    if (content === null) {
      rmSync(full, { force: true })
    } else {
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
  }
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '--allow-empty', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}

export const tag = (dir: string, name: string, sha: string) =>
  git(dir, 'tag', '-a', name, sha, '-m', name)

export const removeRepo = (dir: string) => rmSync(dir, { recursive: true, force: true })
