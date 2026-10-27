import { describe, it, expect } from 'vitest'
import { buildPlan, classifyEntry } from '../../scripts/template-sync/classify.mjs'

const e = (base: string | null, target: string | null, project: string | null, owned = false) => ({
  base,
  target,
  project,
  owned,
})

describe('classifyEntry (tabela §5.2)', () => {
  it.each([
    [e('a', 'a', 'x'), 'unchanged-template', 'none'],
    [e('a', 'b', 'a'), 'template-only', 'write'],
    [e('a', null, 'a'), 'template-only', 'delete'],
    [e(null, 'b', null), 'template-only', 'write'],
    [e('a', 'b', 'b'), 'in-sync', 'none'],
    [e('a', 'b', 'c'), 'both-changed', 'merge'],
    [e(null, 'b', 'c'), 'add-add', 'ask'],
    [e('a', null, 'c'), 'deleted-modified', 'ask'],
    [e('a', 'b', null), 'modified-deleted', 'ask'],
    [e('a', 'b', 'a', true), 'owned', 'none'],
    [e('a', null, null), 'in-sync', 'none'],
  ])('%j → %s/%s', (entry, kind, action) => {
    expect(classifyEntry(entry)).toEqual({ case: kind, action })
  })
})

describe('buildPlan', () => {
  const managed = (p: string) => !p.startsWith('src/') && !p.startsWith('examples/')
  const plan = (over: Partial<Parameters<typeof buildPlan>[0]>) =>
    buildPlan({
      base: new Map(),
      target: new Map(),
      project: new Map(),
      renames: new Map(),
      isManaged: managed,
      projectOwned: [],
      ...over,
    })

  const OLD = 'docs/adr/005-x.md'
  const NEW = 'docs/adr/template/005-x.md'

  it('renome com projeto intocado vira um move só', () => {
    const entries = plan({
      base: new Map([[OLD, 'a']]),
      target: new Map([[NEW, 'b']]),
      project: new Map([[OLD, 'a']]),
      renames: new Map([[NEW, OLD]]),
    })
    expect(entries).toEqual([
      {
        path: NEW,
        from: OLD,
        case: 'template-only',
        action: 'move',
        base: 'a',
        target: 'b',
        project: 'a',
      },
    ])
  })

  it('renome sem mudança de conteúdo também move', () => {
    const entries = plan({
      base: new Map([[OLD, 'a']]),
      target: new Map([[NEW, 'a']]),
      project: new Map([[OLD, 'a']]),
      renames: new Map([[NEW, OLD]]),
    })
    expect(entries[0]).toMatchObject({ path: NEW, from: OLD, action: 'move' })
  })

  it('renome com projeto alterado junta', () => {
    const entries = plan({
      base: new Map([[OLD, 'a']]),
      target: new Map([[NEW, 'b']]),
      project: new Map([[OLD, 'c']]),
      renames: new Map([[NEW, OLD]]),
    })
    expect(entries).toEqual([
      {
        path: NEW,
        from: OLD,
        case: 'both-changed',
        action: 'merge',
        base: 'a',
        target: 'b',
        project: 'c',
      },
    ])
  })

  it('renome cuja origem está fora do manifesto não move: o arquivo do projeto fica', () => {
    const entries = plan({
      base: new Map([['examples/ws/NOTES.md', 'n']]),
      target: new Map([['docs/guides/NOTES.md', 'g']]),
      project: new Map([['examples/ws/NOTES.md', 'n']]),
      renames: new Map([['docs/guides/NOTES.md', 'examples/ws/NOTES.md']]),
    })
    expect(entries).toEqual([
      {
        path: 'docs/guides/NOTES.md',
        case: 'template-only',
        action: 'write',
        base: null,
        target: 'g',
        project: null,
      },
    ])
  })

  it('renome para fora do manifesto: o caminho velho é classificado (apagado no template)', () => {
    const entries = plan({
      base: new Map([['scripts/foo.mjs', 'a']]),
      target: new Map([['examples/ws/foo.mjs', 'a']]),
      project: new Map([['scripts/foo.mjs', 'a']]),
      renames: new Map([['examples/ws/foo.mjs', 'scripts/foo.mjs']]),
    })
    expect(entries).toEqual([
      {
        path: 'scripts/foo.mjs',
        case: 'template-only',
        action: 'delete',
        base: 'a',
        target: null,
        project: 'a',
      },
    ])
  })

  it('a mudança de docs/adr/ para docs/adr/template/ move mesmo com o ADR velho fora do manifesto', () => {
    const entries = plan({
      base: new Map([[OLD, 'a']]),
      target: new Map([[NEW, 'b']]),
      project: new Map([[OLD, 'a']]),
      renames: new Map([[NEW, OLD]]),
      isManaged: (p) => p.startsWith('docs/adr/template/'),
    })
    expect(entries[0]).toMatchObject({ path: NEW, from: OLD, action: 'move' })
  })

  it('ADR próprio do projeto e arquivos fora do manifesto não entram', () => {
    const entries = plan({
      base: new Map([
        ['src/x.ts', 'a'],
        ['examples/a.json', 'a'],
      ]),
      target: new Map([
        ['src/x.ts', 'b'],
        ['examples/a.json', 'b'],
      ]),
      project: new Map([
        ['docs/adr/014-perfil.md', 'p'],
        ['src/x.ts', 'a'],
      ]),
    })
    expect(entries).toEqual([])
  })

  it('projectOwned vira owned e a saída é ordenada', () => {
    const entries = plan({
      base: new Map([
        ['b.md', 'a'],
        ['a.md', 'a'],
      ]),
      target: new Map([
        ['b.md', 'b'],
        ['a.md', 'b'],
      ]),
      project: new Map([
        ['b.md', 'a'],
        ['a.md', 'a'],
      ]),
      projectOwned: ['b.md'],
    })
    expect(entries.map((x) => [x.path, x.case])).toEqual([
      ['a.md', 'template-only'],
      ['b.md', 'owned'],
    ])
  })
})
