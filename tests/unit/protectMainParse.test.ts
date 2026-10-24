import { describe, it, expect } from 'vitest'
import { parseCommand } from '../../hooks/protect-main/parse.mjs'

const argvs = (c: string) => parseCommand(c).map((s) => s.argv)

describe('parseCommand', () => {
  it('splits on shell operators', () => {
    expect(argvs('cd x && git commit -m a; git push | cat')).toEqual([
      ['cd', 'x'],
      ['git', 'commit', '-m', 'a'],
      ['git', 'push'],
      ['cat'],
    ])
  })
  it('splits on ||, & and newlines', () => {
    expect(argvs('a || b & c\nd')).toEqual([['a'], ['b'], ['c'], ['d']])
  })
  it('keeps redirections with & inside the same segment', () => {
    expect(argvs('git push 2>&1 | cat')).toEqual([['git', 'push', '2>&1'], ['cat']])
  })
  it('keeps quoted operators and newlines inside one token', () => {
    expect(argvs('git commit -m "fix main && deploy;\nmore"')).toEqual([
      ['git', 'commit', '-m', 'fix main && deploy;\nmore'],
    ])
  })
  it('ignores heredoc bodies used as commit message', () => {
    const c = 'git commit -m "$(cat <<\'EOF\'\nfeat: x\n\ngit push origin main\nEOF\n)"'
    const segs = parseCommand(c)
    expect(segs).toHaveLength(1)
    expect(segs[0].argv.slice(0, 3)).toEqual(['git', 'commit', '-m'])
    expect(segs[0].ambiguous).toBe(false)
  })
  it('discards top-level heredoc bodies without generating segments', () => {
    const segs = parseCommand('cat <<-EOF\n\tgit push origin main\n\tEOF\ngit status')
    expect(segs.map((s) => s.argv)).toEqual([['cat'], ['git', 'status']])
  })
  it('unwraps bash -c recursively', () => {
    expect(argvs('bash -c "git switch main && git push"')).toEqual([
      ['git', 'switch', 'main'],
      ['git', 'push'],
    ])
    expect(argvs('sh -c \'zsh -c "git push"\'')).toEqual([['git', 'push']])
  })
  it('strips env prefixes', () => {
    expect(argvs('env GIT_X=1 FOO=2 git commit')).toEqual([['git', 'commit']])
    expect(argvs('FOO=1 git push')).toEqual([['git', 'push']])
    expect(argvs('sudo -u bob time command git push')).toEqual([['git', 'push']])
  })
  it('marks eval and variable refspecs as ambiguous', () => {
    expect(parseCommand('eval "git push"')[0].ambiguous).toBe(true)
    expect(parseCommand('git push origin $BRANCH')[0].ambiguous).toBe(true)
    expect(parseCommand('git push origin ${BRANCH}')[0].ambiguous).toBe(true)
    expect(parseCommand("git push origin '$BRANCH'")[0].ambiguous).toBe(false)
  })
  it('marks command substitution and backticks as ambiguous', () => {
    expect(parseCommand('git push origin $(git branch --show-current)')[0].ambiguous).toBe(true)
    expect(parseCommand('git push origin `echo main`')[0].ambiguous).toBe(true)
  })
  it('does not mark expansions inside message/file values as ambiguous', () => {
    expect(parseCommand('git commit -m "fix $X"')[0].ambiguous).toBe(false)
    expect(parseCommand('git commit --message="fix $(date)"')[0].ambiguous).toBe(false)
    expect(parseCommand('git commit -F `mktemp`')[0].ambiguous).toBe(false)
    expect(parseCommand('git commit -m x $BRANCH')[0].ambiguous).toBe(true)
  })
  it('marks unquoted heredocs with command substitution as ambiguous', () => {
    expect(parseCommand('cat <<EOF\n$(git push origin main)\nEOF')[0].ambiguous).toBe(true)
    expect(parseCommand("cat <<'EOF'\n$(git push)\nEOF")[0].ambiguous).toBe(false)
  })
  it('treats parentheses, braces and shell keywords as segment boundaries', () => {
    expect(argvs('(cd x; git push)')).toEqual([
      ['cd', 'x'],
      ['git', 'push'],
    ])
    expect(argvs('if true; then git push; fi')).toEqual([['true'], ['git', 'push']])
  })
  it('ignores comments', () => {
    expect(argvs('git status # git push')).toEqual([['git', 'status']])
  })
})
