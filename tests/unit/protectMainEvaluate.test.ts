import { describe, it, expect } from 'vitest'
import { evaluateCommand, BLOCK_PREFIX } from '../../hooks/protect-main/evaluate.mjs'

const BRANCHES: Record<string, string> = { '/repo': 'main', '/repo/wt': 'feat/x' }
const ALIASES: Record<string, string> = { co: 'commit', sh: '!git push' }

type Opts = { cwd?: string; detached?: boolean; protectedBranches?: string[] }

const evaluate = (command: string, opts: Opts = {}) =>
  evaluateCommand(command, {
    cwd: opts.cwd ?? '/repo',
    protectedBranches: opts.protectedBranches ?? ['main'],
    branchOf: (dir: string) => (opts.detached ? null : (BRANCHES[dir] ?? null)),
    aliasOf: (_dir: string, name: string) => ALIASES[name] ?? null,
  })

const ON_FEAT: Opts = { cwd: '/repo/wt' }

const BLOCKED: [string, Opts?][] = [
  ['git commit -m x'],
  ['git commit --amend'],
  ['git -c user.name=a commit -m x'],
  ['git co -m x'],
  ['git merge feat/x'],
  ['git merge --ff-only FETCH_HEAD'],
  ['git rebase feat/x'],
  ['git cherry-pick abc'],
  ['git revert abc'],
  ['git am p.patch'],
  ['git apply --index p.patch'],
  ['git apply --cached p.patch'],
  ['git apply -3 p.patch'],
  ['git merge --continue'],
  ['git pull origin feat/x'],
  ['git push'],
  ['git push origin'],
  ['git push -u origin HEAD'],
  ['git push --all'],
  ['git push --all', ON_FEAT],
  ['git push --mirror'],
  ['git push --mirror', ON_FEAT],
  ['git push origin main', ON_FEAT],
  ['git push origin +main', ON_FEAT],
  ['git push origin HEAD:main', ON_FEAT],
  ['git push origin x:refs/heads/main', ON_FEAT],
  ['git push origin :main', ON_FEAT],
  ['git push origin --delete main', ON_FEAT],
  ['gh pr merge 1'],
  ['gh pr merge --squash', ON_FEAT],
  ['gh api repos/o/r/pulls/1/merge -X PUT'],
  ['gh api repos/o/r/merges'],
  ['git switch main && git commit -m x', ON_FEAT],
  ['git checkout main && git commit -m x', ON_FEAT],
  ['bash -c "git push origin main"', ON_FEAT],
  ['eval "git push"'],
  ['git push origin $B'],
  ['git sh'],
  ['git $SUB origin main', ON_FEAT],
  ['git co $X', ON_FEAT],
  ['git checkout $B && git commit -m x', ON_FEAT],
  ['gh api $(echo repos/o/r/merges)', ON_FEAT],
  ['cd $DIR && git commit -m x', ON_FEAT],
  ['git checkout foo.txt && git commit -m x'],
  ['git push origin release', { ...ON_FEAT, protectedBranches: ['main', 'release'] }],
  ['git push origin main', { detached: true }],
  ['gh pr merge 1', { detached: true }],
]

const ALLOWED: [string, Opts?][] = [
  ['git merge origin/main'],
  ['git merge --ff-only origin/main'],
  ['git apply p.patch'],
  ['git rebase origin/main'],
  ['git merge --abort'],
  ['git rebase --abort'],
  ['git cherry-pick --skip'],
  ['git revert --quit'],
  ['git rebase --continue', ON_FEAT],
  ['git pull'],
  ['git pull --rebase'],
  ['git pull --ff-only'],
  ['git pull origin main'],
  ['git push origin feat/x', ON_FEAT],
  ['git push --force-with-lease', ON_FEAT],
  ['git push -u origin HEAD', ON_FEAT],
  ['git push origin --delete feat/x', ON_FEAT],
  ['gh pr create --fill'],
  ['gh pr view 1'],
  ['gh api repos/o/r/pulls/1'],
  ['git switch -c feat/y && git commit -m x'],
  ['git checkout -b feat/y && git commit -m x'],
  ['cd wt && git commit -m x'],
  ['git -C /repo/wt commit -m x'],
  ['git -C wt commit -m x'],
  ['git commit -m "fix main"', ON_FEAT],
  ['git commit -m "$(cat <<\'EOF\'\nfeat: x\n\ngit push origin main && deploy;\nEOF\n)"', ON_FEAT],
  ['echo "git push origin main"'],
  ['rg "git commit"'],
  ['npm test'],
  ['git commit -m x', { detached: true }],
  ['git log $X'],
  ['git diff $REF'],
  ['git status && git fetch && git log --oneline'],
  ['git switch main'],
  ['git reset --hard origin/main'],
  ['git lfs pull'],
]

describe('evaluateCommand', () => {
  it.each(BLOCKED)('blocks %s', (command, opts) => {
    const v = evaluate(command, opts)
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.reason.startsWith(BLOCK_PREFIX)).toBe(true)
  })

  it.each(ALLOWED)('allows %s', (command, opts) => {
    expect(evaluate(command, opts)).toEqual({ allowed: true })
  })

  it('asks for the literal form when it cannot verify', () => {
    const v = evaluate('git push origin $B')
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.reason).toContain('escreva o comando por extenso')
  })

  it('uses the exact block prefix', () => {
    expect(BLOCK_PREFIX).toBe(
      'Bloqueado: a `main` só recebe mudanças via PR (CLAUDE.md regra 0, ADR-005). Crie uma branch `tipo/descrição`, faça push e abra o PR; o merge é do humano.'
    )
  })
})
