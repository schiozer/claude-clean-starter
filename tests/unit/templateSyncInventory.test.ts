import { describe, it, expect, afterEach } from 'vitest'
import { findForbidden, inventory } from '../../scripts/template-sync/inventory.mjs'
import { commitFiles, git, makeRepo, removeRepo, tag } from '../helpers/gitRepo'

const repos: string[] = []
afterEach(() => repos.splice(0).forEach(removeRepo))

describe('inventory', () => {
  it('aponta divergentes, ADRs e arquivos próprios; ignora src/', () => {
    const t = makeRepo('ts-tpl-')
    const p = makeRepo('ts-prj-')
    repos.push(t, p)
    const base = commitFiles(t, {
      'template-sync.manifest.json': JSON.stringify({
        managed: ['CLAUDE.md', 'README.md', '.github/**', 'docs/adr/template/**'],
        ignore: [],
      }),
      'CLAUDE.md': 'c\n',
      'README.md': 'r\n',
      '.github/workflows/ci.yml': 'ci\n',
      'docs/adr/template/001-x.md': '# ADR-001: X\n',
    })
    const next = commitFiles(t, { 'README.md': 'r2\n' })
    tag(t, 'v0.1.0', next)
    git(p, 'pull', '-q', t, base)
    commitFiles(p, {
      'CLAUDE.md': 'meu\n',
      '.template-sync.json': JSON.stringify({
        template: 'https://example.com/o/t',
        lastSync: { version: null, commit: base, date: '2026-10-01' },
        projectOwned: [],
      }),
      'docs/adr/014-perfil.md': '# ADR-014: Perfil completo-direto\n\ntexto\n',
      '.github/workflows/deploy.yml': 'd\n',
      'src/app.ts': 'x\n',
    })
    const inv = inventory({ templateDir: t, projectDir: p })
    expect(inv.behind).toBe(1)
    expect(inv.lastSync?.commit).toBe(base)
    expect(inv.divergent).toEqual(['CLAUDE.md', 'README.md'])
    expect(inv.own).toEqual({
      adrTitles: ['ADR-014: Perfil completo-direto'],
      files: ['.github/workflows/deploy.yml'],
    })
  })
})

describe('findForbidden', () => {
  it('case-insensitive, com linha, ignora termos vazios', () => {
    expect(findForbidden('Projeto AcmeFinanças\nok', ['acmefinanças', ''])).toEqual([
      { term: 'acmefinanças', line: 1 },
    ])
  })
})

describe('check-agnostic (CLI)', () => {
  it('sai 1 ao achar termo e 0 quando limpo', async () => {
    const { spawnSync } = await import('node:child_process')
    const { writeFileSync } = await import('node:fs')
    const { join, resolve } = await import('node:path')
    const dir = makeRepo('ts-agn-')
    repos.push(dir)
    writeFileSync(join(dir, 'a.md'), 'linha\nconta Fulano\n')
    const cli = resolve(__dirname, '../../scripts/template-sync.mjs')
    const run = (term: string) =>
      spawnSync(
        process.execPath,
        [cli, 'check-agnostic', '--root', dir, '--term', term, '--files', 'a.md'],
        { encoding: 'utf8' }
      )
    const bad = run('fulano')
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('a.md:2 (fulano)')
    expect(run('ciclano').status).toBe(0)
  })
})
