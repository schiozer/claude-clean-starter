import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { GIT_ENV, commitFiles, git, makeRepo, removeRepo, tag } from '../helpers/gitRepo'

const CLI = resolve(__dirname, '../../scripts/template-sync.mjs')
const MANIFEST = JSON.stringify({ managed: ['**'], ignore: ['src/**'] })
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 3, 4])

const runCli = (...args: string[]) =>
  JSON.parse(execFileSync(process.execPath, [CLI, ...args], { env: GIT_ENV }).toString())

describe('template-sync plan (CLI)', () => {
  let template: string
  let project: string
  let base: string
  let target: string

  beforeEach(() => {
    template = makeRepo('ts-tpl-')
    base = commitFiles(template, {
      'README.md': 'a\n',
      'docs/Ação inicial.md': 'x\n',
      'logo.png': PNG_A,
      'CLAUDE.md': 'c\n',
    })
    target = commitFiles(template, {
      'README.md': 'a\nb\n',
      'logo.png': PNG_B,
      'novo.md': 'n\n',
      'template-sync.manifest.json': MANIFEST,
    })
    tag(template, 'v0.2.0', target)
    project = makeRepo('ts-prj-')
    commitFiles(project, {
      'README.md': 'a\n',
      'docs/Ação inicial.md': 'x\n',
      'logo.png': PNG_A,
      'CLAUDE.md': 'meu\n',
      'src/app.ts': 'app\n',
    })
  })
  afterEach(() => {
    removeRepo(template)
    removeRepo(project)
  })

  it('classifica e aponta o commit do tag', () => {
    const plan = runCli(
      'plan',
      '--template',
      template,
      '--project',
      project,
      '--target',
      'v0.2.0',
      '--base',
      base
    )
    expect(plan.base).toBe(base)
    expect(plan.target).toEqual({ tag: 'v0.2.0', commit: target })
    const byPath = Object.fromEntries(
      plan.entries.map((x: { path: string; action: string }) => [x.path, x.action])
    )
    expect(byPath).toEqual({
      'CLAUDE.md': 'none',
      'README.md': 'write',
      'docs/Ação inicial.md': 'none',
      'logo.png': 'write',
      'novo.md': 'write',
      'template-sync.manifest.json': 'write',
    })
  })

  it('sem controle e sem --base explica a adoção', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'plan', '--template', template, '--project', project, '--target', 'v0.2.0'],
      { encoding: 'utf8', env: GIT_ENV }
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/informe --base <sha\|none>/)
  })

  it('--base none trata tudo como novo', () => {
    const plan = runCli(
      'plan',
      '--template',
      template,
      '--project',
      project,
      '--target',
      'v0.2.0',
      '--base',
      'none'
    )
    expect(plan.base).toBeNull()
    const cases = Object.fromEntries(
      plan.entries.map((x: { path: string; case: string }) => [x.path, x.case])
    )
    expect(cases['CLAUDE.md']).toBe('add-add')
    expect(cases['README.md']).toBe('add-add')
    expect(cases['docs/Ação inicial.md']).toBe('in-sync')
  })

  it('tag inexistente vira erro claro', () => {
    git(template, 'tag', '-d', 'v0.2.0')
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        'plan',
        '--template',
        template,
        '--project',
        project,
        '--target',
        'v0.2.0',
        '--base',
        base,
      ],
      { encoding: 'utf8', env: GIT_ENV }
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/v0\.2\.0/)
  })
})
