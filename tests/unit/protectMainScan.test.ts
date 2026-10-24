import { describe, it, expect } from 'vitest'
import { collectSubstitutions, scan, scanWords } from '../../hooks/protect-main/scan.mjs'

const texts = (c: string) => scan(c).map((s) => s.tokens.map((t) => t.text))

describe('scan', () => {
  it('records the operators around each segment', () => {
    const segs = scan('a && b | c; d &')
    expect(segs.map((s) => [s.before, s.after])).toEqual([
      ['', '&&'],
      ['&&', '|'],
      ['|', ';'],
      [';', '&'],
    ])
  })
  it('treats |& as a pipe', () => {
    expect(scan('a |& b').map((s) => [s.before, s.after])).toEqual([
      ['', '|'],
      ['|', ''],
    ])
  })
  it('assigns subshell scopes', () => {
    const segs = scan('(a; (b)); c')
    expect(segs.map((s) => s.scope)).toEqual([['p1'], ['p1', 'p2'], []])
  })
  it('collects substitution bodies in order, including inside quotes and ${…}', () => {
    const [seg] = scan('echo "$(git commit -m x)" `ls` ${X:-$(pwd)}')
    expect(seg.substitutions).toEqual(['git commit -m x', 'ls', 'pwd'])
  })
  it('keeps heredoc bodies inside a substitution body', () => {
    const [seg] = scan("x=$(bash <<'X'\ngit push\nX\n)")
    expect(seg.substitutions).toEqual(["bash <<'X'\ngit push\nX\n"])
  })
  it('attaches heredoc bodies to the segment that opened them', () => {
    const segs = scan("bash <<'X' | cat\ngit push\nX\nls")
    expect(segs.map((s) => s.heredocs)).toEqual([['git push'], [], []])
  })
  it('collects substitutions from unquoted heredoc bodies only', () => {
    expect(scan('cat <<EOF\n$(git push)\nEOF')[0].substitutions).toEqual(['git push'])
    expect(scan("cat <<'EOF'\n$(git push)\nEOF")[0].substitutions).toEqual([])
  })
  it('keeps here-strings as a token instead of a heredoc', () => {
    expect(texts('bash <<< "git push"')).toEqual([['bash', '<<<', 'git push']])
  })
  it('marks ANSI-C strings with escapes and brace expansion as dynamic', () => {
    const [seg] = scan("a $'\\x6d' $'m' {x,y} {1..3} @{u}")
    expect(seg.tokens.map((t) => t.dynamic)).toEqual([false, true, false, true, true, false])
  })
})

describe('collectSubstitutions', () => {
  it('finds $(…) and backticks, skipping escapes', () => {
    expect(collectSubstitutions('a $(b) \\$(c) `d`')).toEqual(['b', 'd'])
  })
})

describe('scanWords', () => {
  it('splits a string into words', () => {
    expect(scanWords('git push "origin x"').map((t) => t.text)).toEqual(['git', 'push', 'origin x'])
  })
})
