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
