import { describe, it, expect } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  MANIFEST_PATH,
  globToRegExp,
  makeMatcher,
  parseManifest,
} from '../../scripts/template-sync/manifest.mjs'

const ROOT = resolve(__dirname, '../..')
const repoManifest = () =>
  parseManifest(JSON.parse(readFileSync(resolve(ROOT, MANIFEST_PATH), 'utf8')))

/** Testes em tests/unit fora do manifesto. No projeto derivado a pasta também tem os do app. */
function testsOutsideManifest(root: string): string[] {
  if (existsSync(join(root, '.template-sync.json'))) return []
  const m = makeMatcher(repoManifest())
  return readdirSync(join(root, 'tests/unit')).filter((name) => !m(`tests/unit/${name}`))
}

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

  it('cada manifesto vale com o próprio ignore: o que o alvo deixou de ignorar entra', () => {
    const m = makeMatcher(
      { managed: ['docs/**'], ignore: [] },
      { managed: ['docs/**'], ignore: ['docs/foo/**'] }
    )
    expect(m('docs/foo/new.md')).toBe(true)
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
    expect(testsOutsideManifest(ROOT)).toEqual([])
  })

  it('num projeto derivado os testes do app em tests/unit não contam', () => {
    const project = mkdtempSync(join(tmpdir(), 'ts-manifest-'))
    mkdirSync(join(project, 'tests/unit'), { recursive: true })
    writeFileSync(join(project, 'tests/unit/ResourceService.test.ts'), '')
    writeFileSync(join(project, '.template-sync.json'), '{}')
    expect(testsOutsideManifest(project)).toEqual([])
  })
})
