import { describe, it, expect } from 'vitest'
import { parseCommand } from '../../hooks/protect-main/parse.mjs'

const argvs = (c: string) => parseCommand(c).map((s) => s.argv)
const last = (c: string) => {
  const segs = parseCommand(c)
  return segs[segs.length - 1]
}

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
    expect(segs.map((s) => s.argv.slice(0, 3))).toEqual([['cat'], ['git', 'commit', '-m']])
    expect(segs[1].argv[3]).toBe("$(cat <<'EOF'\n)")
    expect(segs[1].ambiguous).toBe(false)
  })
  it('discards top-level heredoc bodies without generating segments', () => {
    const segs = parseCommand('cat <<-EOF\n\tgit push origin main\n\tEOF\ngit status')
    expect(segs.map((s) => s.argv)).toEqual([['cat'], ['git', 'status']])
  })
  it('does not hide a command after a heredoc message containing a quote', () => {
    const c = 'git commit -m "$(cat <<\'EOF\'\nfix: trata "aspas\nEOF\n)" && git push origin main'
    const segs = parseCommand(c)
    expect(segs.map((s) => s.argv.slice(0, 2))).toEqual([
      ['cat'],
      ['git', 'commit'],
      ['git', 'push'],
    ])
    expect(segs[2].argv).toEqual(['git', 'push', 'origin', 'main'])
    expect(segs[2].ambiguous).toBe(false)
  })
  it("handles ) and ' inside a heredoc message", () => {
    const c = "git commit -m \"$(cat <<'EOF'\nfix (x) it's\nEOF\n)\"; git status"
    expect(argvs(c).map((a) => a.slice(0, 2))).toEqual([
      ['cat'],
      ['git', 'commit'],
      ['git', 'status'],
    ])
  })
  it('keeps a top-level command substitution as one token', () => {
    const segs = parseCommand('git push origin $(git branch --show-current)')
    expect(segs.map((s) => s.argv)).toEqual([
      ['git', 'branch', '--show-current'],
      ['git', 'push', 'origin', '$(git branch --show-current)'],
    ])
    expect(segs[1].ambiguous).toBe(true)
  })
  it('handles nested command substitution', () => {
    expect(argvs('echo $(echo $(echo x)) y; ls')).toEqual([
      ['echo', 'x'],
      ['echo', '$(echo x)'],
      ['echo', '$(echo $(echo x))', 'y'],
      ['ls'],
    ])
  })
  it('unwraps shells with option arguments before -c', () => {
    expect(argvs('bash -o pipefail -c "git push"')).toEqual([['git', 'push']])
    expect(argvs('bash +e -O extglob -c "git push"')).toEqual([['git', 'push']])
  })
  it('marks a shell -c without a script as ambiguous', () => {
    expect(parseCommand('bash -c')[0].ambiguous).toBe(true)
  })
  it('does not exempt -m for git checkout/switch', () => {
    expect(parseCommand('git checkout -m $B')[0].ambiguous).toBe(true)
    expect(parseCommand('git switch -m $B')[0].ambiguous).toBe(true)
    expect(parseCommand('git -C x commit -m "$X"')[0].ambiguous).toBe(false)
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
    expect(last('git push origin $(git branch --show-current)').ambiguous).toBe(true)
    expect(last('git push origin `echo main`').ambiguous).toBe(true)
  })
  it('does not mark expansions inside message/file values as ambiguous', () => {
    expect(parseCommand('git commit -m "fix $X"')[0].ambiguous).toBe(false)
    expect(last('git commit --message="fix $(date)"').ambiguous).toBe(false)
    expect(last('git commit -F `mktemp`').ambiguous).toBe(false)
    expect(parseCommand('git commit -m x $BRANCH')[0].ambiguous).toBe(true)
  })
  it('marks unquoted heredocs with command substitution as ambiguous', () => {
    expect(last('cat <<EOF\n$(git push origin main)\nEOF').ambiguous).toBe(true)
    expect(parseCommand("cat <<'EOF'\n$(git push)\nEOF")[0].ambiguous).toBe(false)
  })
  it('treats parentheses, braces and shell keywords as segment boundaries', () => {
    expect(argvs('(cd x; git push)')).toEqual([
      ['cd', 'x'],
      ['git', 'push'],
    ])
    expect(argvs('if true; then git push; fi')).toEqual([['true'], ['git', 'push']])
  })
  it('emits substitution bodies before the enclosing segment, in their own scope', () => {
    const segs = parseCommand('x=$(git push origin main); echo "$(git commit -m y)" `ls`')
    expect(segs.map((s) => s.argv)).toEqual([
      ['git', 'push', 'origin', 'main'],
      ['git', 'commit', '-m', 'y'],
      ['ls'],
      ['echo', '$(git commit -m y)', '`ls`'],
    ])
    expect(segs[0].scope).toHaveLength(1)
    expect(segs[3].scope).toEqual([])
  })
  it('evaluates substitutions inside message values and unquoted heredoc bodies', () => {
    expect(argvs('git commit -m "$(git push origin main)"')[0]).toEqual([
      'git',
      'push',
      'origin',
      'main',
    ])
    expect(argvs('cat <<EOF\n$(git push)\nEOF')[0]).toEqual(['git', 'push'])
    expect(argvs("cat <<'EOF'\n$(git push)\nEOF")).toEqual([['cat']])
  })
  it('marks subshell scopes, pipelines and background segments', () => {
    const segs = parseCommand('(cd a && b) && cd c | d; e & f')
    expect(segs.map((s) => s.argv[0])).toEqual(['cd', 'b', 'cd', 'd', 'e', 'f'])
    expect(segs[0].scope).toEqual(segs[1].scope)
    expect(segs[0].scope).toHaveLength(1)
    expect(segs[2].scope).toEqual([])
    expect(segs.map((s) => s.pipeline)).toEqual([false, false, true, true, false, false])
    expect(segs.map((s) => s.background)).toEqual([false, false, false, false, true, false])
  })
  it('gives distinct scopes to sibling subshells', () => {
    const segs = parseCommand('(a); (b)')
    expect(segs[0].scope).not.toEqual(segs[1].scope)
  })
  it('puts bash -c scripts in their own scope', () => {
    expect(parseCommand('bash -c "cd x"')[0].scope).toHaveLength(1)
  })
  it('unwraps wrappers with option arities', () => {
    expect(argvs('timeout -s KILL 60 git push')).toEqual([['git', 'push']])
    expect(argvs('nice -n 5 nohup exec git push')).toEqual([['git', 'push']])
    expect(argvs('stdbuf -o L ionice -c 3 caffeinate -i doas -u bob git push')).toEqual([
      ['git', 'push'],
    ])
    expect(argvs('/usr/bin/env git push')).toEqual([['git', 'push']])
    expect(argvs('env -S "git push origin main"')).toEqual([['git', 'push', 'origin', 'main']])
    expect(argvs('constructor x')).toEqual([['constructor', 'x']])
  })
  it('marks xargs as opaque', () => {
    const segs = parseCommand('echo main | xargs -n 1 git push origin')
    expect(segs[1].argv).toEqual(['git', 'push', 'origin'])
    expect(segs[1].opaqueArgs).toBe(true)
    expect(segs[0].opaqueArgs).toBe(false)
  })
  it('surfaces git environment overrides', () => {
    expect(parseCommand('GIT_DIR=x git commit')[0].gitEnv).toBe(true)
    expect(parseCommand('env GIT_CONFIG_COUNT=1 git p')[0].gitEnv).toBe(true)
    expect(parseCommand('env -C /x git commit')[0].gitEnv).toBe(true)
    expect(parseCommand('export GIT_WORK_TREE=x')[0].gitEnv).toBe(true)
    expect(parseCommand('GIT_DIR=x')[0]).toMatchObject({ argv: [], gitEnv: true })
    expect(parseCommand('FOO=1 git commit')[0].gitEnv).toBe(false)
  })
  it('parses shell scripts from heredocs and here-strings', () => {
    expect(argvs("bash <<'X'\ngit push origin main\nX")).toEqual([
      ['git', 'push', 'origin', 'main'],
    ])
    expect(argvs('bash <<< "git push"')).toEqual([['git', 'push']])
    expect(argvs('dash -c "git push"')).toEqual([['git', 'push']])
    expect(argvs('ksh -c "git push"')).toEqual([['git', 'push']])
  })
  it('flags a shell reading its script from a pipe', () => {
    const segs = parseCommand('echo "git push" | bash')
    expect(segs[1].stdinScript).toBe(true)
    expect(parseCommand('bash scripts/x.sh')[0].stdinScript).toBe(false)
    expect(parseCommand('cat x | bash scripts/x.sh')[1].stdinScript).toBe(false)
  })
  it('marks brace expansion and ANSI-C escapes as dynamic', () => {
    expect(parseCommand('git push origin {main,x}')[0].ambiguous).toBe(true)
    expect(parseCommand("git push origin $'\\x6dain'")[0].ambiguous).toBe(true)
    expect(parseCommand("git push origin $'main'")[0]).toMatchObject({
      argv: ['git', 'push', 'origin', 'main'],
      ambiguous: false,
    })
    expect(parseCommand('git log @{u}')[0].ambiguous).toBe(false)
  })
  it('ignores comments', () => {
    expect(argvs('git status # git push')).toEqual([['git', 'status']])
  })
})
