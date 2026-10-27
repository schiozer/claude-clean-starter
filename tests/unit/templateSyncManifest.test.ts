import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MANIFEST_PATH,
  globToRegExp,
  makeMatcher,
  parseManifest,
} from '../../scripts/template-sync/manifest.mjs'

const ROOT = resolve(__dirname, '../..')
const repoManifest = () =>
  parseManifest(JSON.parse(readFileSync(resolve(ROOT, MANIFEST_PATH), 'utf8')))

describe('globToRegExp', () => {
  it('** atravessa diretórios, * não', () => {
    expect(globToRegExp('.claude/**').test('.claude/skills/x/SKILL.md')).toBe(true)
    expect(globToRegExp('docs/*.md').test('docs/a/b.md')).toBe(false)
    expect(globToRegExp('docs/*.md').test('docs/a.md')).toBe(true)
    expect(globToRegExp('.env.*.local').test('.env.prod.local')).toBe(true)
    expect(globToRegExp('package.json').test('examples/x/package.json')).toBe(false)
  })
  it('**/ no meio casa zero ou mais diretórios', () => {
    expect(globToRegExp('docs/**/x.md').test('docs/x.md')).toBe(true)
    expect(globToRegExp('docs/**/x.md').test('docs/a/b/x.md')).toBe(true)
  })
})

describe('parseManifest', () => {
  it('rejeita forma inválida', () => {
    expect(() => parseManifest({ managed: 'x' })).toThrow(/Manifesto inválido/)
    expect(() => parseManifest(null)).toThrow(/Manifesto inválido/)
    expect(() => parseManifest({ managed: ['a'], ignore: [1] })).toThrow(/Manifesto inválido/)
  })
})

describe('makeMatcher', () => {
  it('ignore vence managed e a união dos manifestos vale', () => {
    const m = makeMatcher(
      { managed: ['.claude/**'], ignore: ['.claude/settings.local.json'] },
      { managed: ['docs/adr/template/**'], ignore: [] }
    )
    expect(m('.claude/settings.json')).toBe(true)
    expect(m('.claude/settings.local.json')).toBe(false)
    expect(m('docs/adr/template/005-x.md')).toBe(true)
    expect(m('src/app/page.tsx')).toBe(false)
  })

  it('o manifesto do repo gerencia os testes do template mas não src/ nem examples/', () => {
    const m = makeMatcher(repoManifest())
    expect(m('tests/unit/release.test.ts')).toBe(true)
    expect(m('tests/unit/meuApp.test.ts')).toBe(false)
    expect(m('examples/walking-skeleton/package.json')).toBe(false)
    expect(m('.claude/settings.local.json')).toBe(false)
    expect(m('.env.local')).toBe(false)
    expect(m('.env.local.example')).toBe(true)
  })

  it('todo arquivo de tests/unit do template está no manifesto', () => {
    const m = makeMatcher(repoManifest())
    const missing = readdirSync(resolve(ROOT, 'tests/unit')).filter(
      (name) => !m(`tests/unit/${name}`)
    )
    expect(missing).toEqual([])
  })
})
