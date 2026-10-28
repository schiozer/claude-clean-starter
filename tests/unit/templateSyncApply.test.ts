import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { applyPlan, examplesNotes, finishSync } from '../../scripts/template-sync/apply.mjs'
import { plan as buildCliPlan } from '../../scripts/template-sync.mjs'
import { GIT_ENV, commitFiles, git, makeRepo, removeRepo, tag } from '../helpers/gitRepo'

const CLI = resolve(__dirname, '../../scripts/template-sync.mjs')
const MANIFEST = JSON.stringify({ managed: ['**'], ignore: ['src/**'] })
const URL = 'https://example.com/owner/template'
const lines = (n: number, change: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => change[i] ?? `linha ${i}`).join('\n') + '\n'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 8])

describe('applyPlan / finishSync', () => {
  let template: string
  let project: string
  let base: string

  beforeEach(() => {
    template = makeRepo('ts-tpl-')
    base = commitFiles(template, {
      'template-sync.manifest.json': MANIFEST,
      'README.md': 'a\n',
      'velho.md': 'v\n',
      'docs/adr/005-x.md': 'adr\n',
      'CLAUDE.md': lines(20),
      'conflito.md': 'um\n',
      'package.json': '{\n  "a": 1,\n  "b": 2,\n  "c": 3,\n  "d": 4,\n  "e": 5\n}\n',
      'pergunta.md': 'p\n',
      'hooks/protect-main/config.json': '{ "requiredChecks": [] }\n',
    })
    project = makeRepo('ts-prj-')
    git(project, 'pull', '-q', template, 'main')
  })
  afterEach(() => {
    removeRepo(template)
    removeRepo(project)
  })

  const target = (files: Record<string, string | Buffer | null>) => {
    const sha = commitFiles(template, files, 'alvo')
    tag(template, 'v0.2.0', sha)
    return sha
  }
  const plan = () => buildCliPlan({ template, project, target: 'v0.2.0', base })
  const apply = () => applyPlan({ templateDir: template, projectDir: project, plan: plan() })
  const read = (p: string) => readFileSync(join(project, p), 'utf8')

  it('write (inclui binário e executável), delete e move', () => {
    git(template, 'mv', 'docs/adr/005-x.md', 'docs/adr/005-y.md')
    target({
      'README.md': 'a\nb\n',
      'logo.png': PNG,
      'velho.md': null,
      '.githooks/pre-push': '#!/bin/sh\n',
    })
    git(template, 'update-index', '--chmod=+x', '.githooks/pre-push')
    git(template, 'commit', '-q', '-m', 'x')
    git(template, 'tag', '-f', '-a', 'v0.2.0', '-m', 'v0.2.0')
    const report = apply()
    expect(read('README.md')).toBe('a\nb\n')
    expect(readFileSync(join(project, 'logo.png')).equals(PNG)).toBe(true)
    expect(existsSync(join(project, 'velho.md'))).toBe(false)
    expect(read('docs/adr/005-y.md')).toBe('adr\n')
    expect(existsSync(join(project, 'docs/adr/005-x.md'))).toBe(false)
    expect(statSync(join(project, '.githooks/pre-push')).mode & 0o111).not.toBe(0)
    expect(report.applied).toEqual(
      expect.arrayContaining(['README.md', 'logo.png', 'velho.md', 'docs/adr/005-y.md'])
    )
  })

  it('merge sem conflito junta os dois lados', () => {
    commitFiles(project, { 'CLAUDE.md': lines(20, { 2: 'do projeto' }) })
    target({ 'CLAUDE.md': lines(20, { 17: 'do template' }) })
    const report = apply()
    expect(read('CLAUDE.md')).toContain('do projeto')
    expect(read('CLAUDE.md')).toContain('do template')
    expect(report.merged).toEqual(['CLAUDE.md'])
  })

  it('merge com conflito deixa marcadores', () => {
    commitFiles(project, { 'conflito.md': 'projeto\n' })
    target({ 'conflito.md': 'template\n' })
    const report = apply()
    expect(read('conflito.md')).toContain('<<<<<<< projeto')
    expect(report.conflicts).toEqual([{ path: 'conflito.md', kind: 'markers' }])
  })

  it('merge de JSON sem marcadores mas inválido vira conflito', () => {
    // cada lado mexe numa linha distante; a junção limpa ainda deixa uma vírgula sobrando
    commitFiles(project, {
      'package.json': '{\n  "a": 1,\n  "b": 2,\n  "c": 3,\n  "d": 4,\n  "e": 5,\n}\n',
    })
    target({ 'package.json': '{\n  "a": 10,\n  "b": 2,\n  "c": 3,\n  "d": 4,\n  "e": 5\n}\n' })
    const report = apply()
    expect(read('package.json')).not.toContain('<<<<<<<')
    expect(report.conflicts).toEqual([{ path: 'package.json', kind: 'invalid-json' }])
  })

  it('binário mudado nos dois lados vira conflito sem tocar o arquivo nem parar o apply', () => {
    base = commitFiles(template, { 'docs/img.png': PNG })
    git(project, 'pull', '-q', template, 'main')
    const mine = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1])
    commitFiles(project, { 'docs/img.png': mine })
    target({ 'docs/img.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 2]), 'README.md': 'a\nb\n' })
    const report = apply()
    expect(readFileSync(join(project, 'docs/img.png'))).toEqual(mine)
    expect(report.conflicts).toEqual([{ path: 'docs/img.png', kind: 'binary' }])
    expect(report.applied).toContain('README.md')
  })

  it('ask não toca o arquivo', () => {
    commitFiles(project, { 'pergunta.md': 'meu\n' })
    target({ 'pergunta.md': null })
    const report = apply()
    expect(read('pergunta.md')).toBe('meu\n')
    expect(report.asked).toEqual([{ path: 'pergunta.md', case: 'deleted-modified' }])
  })

  it('plan → apply → finish → commit → novo plan: nada a fazer', () => {
    commitFiles(project, { 'CLAUDE.md': lines(20, { 2: 'do projeto' }) })
    const sha = target({
      'README.md': 'novo\n',
      'CLAUDE.md': lines(20, { 17: 'tpl' }),
      'velho.md': null,
    })
    apply()
    finishSync({
      projectDir: project,
      templateUrl: URL,
      tag: 'v0.2.0',
      commit: sha,
      date: '2026-10-27',
    })
    commitFiles(project, {}, 'sync')
    const again = buildCliPlan({ template, project, target: 'v0.2.0' })
    expect(again.base).toBe(sha)
    expect(again.entries.every((e: { action: string }) => e.action === 'none')).toBe(true)
  })

  it('finish sem controle e sem URL pede a URL; com controle preserva template e projectOwned', () => {
    const sha = git(template, 'rev-parse', 'HEAD')
    expect(() =>
      finishSync({ projectDir: project, tag: 'v0.2.0', commit: sha, date: '2026-10-27' })
    ).toThrow('Adoção: informe --template-url.')
    writeFileSync(
      join(project, '.template-sync.json'),
      JSON.stringify({
        template: URL,
        lastSync: { version: null, commit: sha, date: '2026-10-01' },
        projectOwned: ['x.md'],
      })
    )
    const control = finishSync({
      projectDir: project,
      tag: 'v0.2.0',
      commit: sha,
      date: '2026-10-27',
    })
    expect(control).toEqual({
      template: URL,
      lastSync: { version: 'v0.2.0', commit: sha, date: '2026-10-27' },
      projectOwned: ['x.md'],
    })
  })

  it('examplesNotes aponta citações ao exemplo num projeto sem examples/', () => {
    mkdirSync(join(project, 'hooks/protect-main'), { recursive: true })
    writeFileSync(
      join(project, 'hooks/protect-main/config.json'),
      '{ "requiredChecks": ["Walking Skeleton (example)"] }\n'
    )
    expect(examplesNotes(project, ['hooks/protect-main/config.json', 'README.md'])).toEqual([
      'hooks/protect-main/config.json: cita o exemplo (examples/), que o projeto não tem — decida no PR se remove.',
    ])
    mkdirSync(join(project, 'examples'))
    expect(examplesNotes(project, ['hooks/protect-main/config.json'])).toEqual([])
  })

  it('CLI: apply recusa árvore suja; apply + finish pela CLI', () => {
    const sha = target({ 'README.md': 'cli\n' })
    const planFile = join(project, '..', `plan-${Date.now()}.json`)
    writeFileSync(planFile, JSON.stringify(plan()))
    writeFileSync(join(project, 'sujo.txt'), 'x')
    const dirty = spawnSync(
      process.execPath,
      [CLI, 'apply', '--template', template, '--project', project, '--plan', planFile],
      { encoding: 'utf8', env: GIT_ENV }
    )
    expect(dirty.status).toBe(1)
    expect(dirty.stderr).toContain('Árvore suja no projeto: faça commit ou stash antes do sync.')
    git(project, 'clean', '-fq')
    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [CLI, 'apply', '--template', template, '--project', project, '--plan', planFile],
        { env: GIT_ENV }
      ).toString()
    )
    expect(report.applied).toEqual(['README.md'])
    const control = JSON.parse(
      execFileSync(
        process.execPath,
        [
          CLI,
          'finish',
          '--project',
          project,
          '--template',
          template,
          '--target',
          'v0.2.0',
          '--template-url',
          URL,
        ],
        { env: GIT_ENV }
      ).toString()
    )
    expect(control.lastSync).toMatchObject({ version: 'v0.2.0', commit: sha })
    expect(control.lastSync.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
