import { describe, it, expect, afterEach } from 'vitest'
import { latestRelease, proposeBase, releasesAfter } from '../../scripts/template-sync/versions.mjs'
import { commitFiles, git, makeRepo, removeRepo, tag } from '../helpers/gitRepo'

const repos: string[] = []
const repo = (prefix: string) => {
  const dir = makeRepo(prefix)
  repos.push(dir)
  return dir
}
afterEach(() => repos.splice(0).forEach(removeRepo))

describe('latestRelease', () => {
  it('maior tag SemVer numérica; ignora tags fora do padrão', () => {
    const t = repo('ts-tpl-')
    const a = commitFiles(t, { 'a.md': '1\n' })
    const b = commitFiles(t, { 'a.md': '2\n' })
    tag(t, 'v0.10.0', a)
    tag(t, 'v0.9.0', b)
    tag(t, 'nao-semver', b)
    expect(latestRelease(t)).toEqual({ tag: 'v0.10.0', commit: a })
  })

  it('sem tags → null', () => {
    const t = repo('ts-tpl-')
    commitFiles(t, { 'a.md': '1\n' })
    expect(latestRelease(t)).toBeNull()
  })
})

describe('releasesAfter', () => {
  it('conta Releases depois de um commit sem tag e nenhuma a partir da última', () => {
    const t = repo('ts-tpl-')
    const old = commitFiles(t, { 'a.md': '0\n' })
    const one = commitFiles(t, { 'a.md': '1\n' })
    const two = commitFiles(t, { 'a.md': '2\n' })
    tag(t, 'v0.2.0', two)
    tag(t, 'v0.1.0', one)
    expect(releasesAfter(t, { version: null, commit: old, date: '2026-10-01' })).toEqual([
      'v0.1.0',
      'v0.2.0',
    ])
    expect(releasesAfter(t, { version: 'v0.2.0', commit: two, date: '2026-10-27' })).toEqual([])
    expect(releasesAfter(t, { version: 'v0.1.0', commit: one, date: '2026-10-27' })).toEqual([
      'v0.2.0',
    ])
  })
})

describe('proposeBase', () => {
  it('o commit com mais arquivos idênticos vem primeiro', () => {
    const t = repo('ts-tpl-')
    commitFiles(t, { 'a.md': '1\n', 'b.md': '1\n', 'examples/x.json': '1\n' })
    const second = commitFiles(t, { 'a.md': '2\n', 'b.md': '2\n' })
    commitFiles(t, { 'a.md': '3\n', 'b.md': '3\n' })
    const p = repo('ts-prj-')
    commitFiles(p, { 'a.md': '2\n', 'b.md': '2\n', 'examples/x.json': '1\n', 'src/app.ts': 'x\n' })
    const ranked = proposeBase(t, p)
    expect(ranked).toHaveLength(3)
    expect(ranked[0]).toMatchObject({ commit: second, identical: 2, total: 2 })
    expect(ranked[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(git(t, 'rev-list', '--count', 'HEAD')).toBe('3')
  })
})
