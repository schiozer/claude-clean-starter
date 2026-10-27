import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyPlan } from '../../scripts/template-sync/apply.mjs'
import { adrMoves, rewriteAdrLinks } from '../../scripts/template-sync/links.mjs'
import { plan } from '../../scripts/template-sync.mjs'
import { commitFiles, git, makeRepo, removeRepo, tag } from '../helpers/gitRepo'

const moves = new Map([['docs/adr/005-trunk.md', 'docs/adr/template/005-trunk.md']])

describe('rewriteAdrLinks', () => {
  it.each([
    ['[x](./docs/adr/005-trunk.md)', 'CLAUDE.md', '[x](./docs/adr/template/005-trunk.md)'],
    ['[x](../../docs/adr/005-trunk.md)', 'src/a/b.ts', '[x](../../docs/adr/template/005-trunk.md)'],
    [
      '[x](../adr/005-trunk.md#decisão)',
      'docs/guides/g.md',
      '[x](../adr/template/005-trunk.md#decisão)',
    ],
    ['[x](./005-trunk.md)', 'docs/adr/020-meu.md', '[x](./template/005-trunk.md)'],
    ['[x](005-trunk.md)', 'docs/adr/020-meu.md', '[x](./template/005-trunk.md)'],
    ['[x](./014-perfil.md)', 'docs/adr/020-meu.md', '[x](./014-perfil.md)'],
    ['[x](docs/adr/template/005-trunk.md)', 'CLAUDE.md', '[x](docs/adr/template/005-trunk.md)'],
    ['[x](./005-trunk.md)', 'docs/guides/g.md', '[x](./005-trunk.md)'],
  ])('%s em %s', (text, file, expected) => {
    expect(rewriteAdrLinks(text, file, moves)).toBe(expected)
  })
})

describe('adrMoves', () => {
  it('só ADRs diretos em docs/adr/ indo para docs/adr/template/', () => {
    const renames = new Map([
      ['docs/adr/template/005-trunk.md', 'docs/adr/005-trunk.md'],
      ['docs/guides/novo.md', 'docs/guides/velho.md'],
      ['docs/adr/template/x/1.md', 'docs/adr/x/1.md'],
    ])
    expect(adrMoves(renames)).toEqual(moves)
  })
})

describe('sync com renome de ADR', () => {
  let template: string
  let project: string
  afterEach(() => {
    if (template) removeRepo(template)
    if (project) removeRepo(project)
  })

  it('reescreve só os links para o ADR do template movido', () => {
    template = makeRepo('ts-tpl-')
    const base = commitFiles(template, {
      'template-sync.manifest.json': JSON.stringify({
        managed: ['docs/adr/template/**', 'docs/adr/0*.md'],
      }),
      'docs/adr/005-trunk.md': '# 005\n',
    })
    const target = commitFiles(
      template,
      { 'docs/adr/005-trunk.md': null, 'docs/adr/template/005-trunk.md': '# 005\n' },
      'mover'
    )
    tag(template, 'v0.2.0', target)
    project = makeRepo('ts-prj-')
    git(project, 'pull', '-q', template, base)
    // o manifesto da base gerencia docs/adr/0*.md; o ADR próprio fica fora porque não está no template
    commitFiles(project, {
      'docs/adr/014-perfil.md': 'Ver [trunk](./005-trunk.md) e [x](./013-x.md).\n',
      'docs/adr/013-x.md': '# 013 do projeto\n',
    })
    const report = applyPlan({
      templateDir: template,
      projectDir: project,
      plan: plan({ template, project, target: 'v0.2.0', base }),
    })
    expect(readFileSync(join(project, 'docs/adr/014-perfil.md'), 'utf8')).toBe(
      'Ver [trunk](./template/005-trunk.md) e [x](./013-x.md).\n'
    )
    expect(report.linkRewrites).toEqual(['docs/adr/014-perfil.md'])
    expect(report.applied).toEqual(['docs/adr/template/005-trunk.md'])
  })
})
