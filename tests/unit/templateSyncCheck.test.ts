import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { evaluateBehind, parseRepoUrl, runCheck } from '../../scripts/template-sync-check.mjs'

const SHA = 'a'.repeat(40)
const FOOTER = 'Rode /template-sync no projeto para trazer as mudanças (abre um PR).'
const rel = (tag: string, after: boolean) => ({ tag, body: `notas ${tag}`, after })

describe('parseRepoUrl', () => {
  it.each([
    ['https://github.com/owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo.git', 'owner/repo'],
    ['https://github.com/owner/repo/', 'owner/repo'],
  ])('%s', (url, expected) => expect(parseRepoUrl(url)).toBe(expected))
  it('outro formato lança', () => expect(() => parseRepoUrl('https://gitlab.com/o/r')).toThrow())
})

describe('evaluateBehind', () => {
  const releases = [rel('v0.1.0', false), rel('v0.2.0', true), rel('v0.3.0', true)]

  it('atrás com versão', () => {
    const r = evaluateBehind({
      lastSync: { version: 'v0.1.0', commit: SHA, date: '2026-10-01' },
      releases,
    })
    expect(r).toMatchObject({
      state: 'behind',
      title: 'Template: 2 versões atrás (v0.1.0 → v0.3.0)',
    })
    if (r.state !== 'behind') throw new Error('esperado behind')
    expect(r.body.indexOf('## v0.2.0\n\nnotas v0.2.0')).toBeGreaterThanOrEqual(0)
    expect(r.body.indexOf('## v0.2.0')).toBeLessThan(r.body.indexOf('## v0.3.0'))
    expect(r.body).not.toContain('## v0.1.0')
    expect(r.body.trimEnd().endsWith(FOOTER)).toBe(true)
  })

  it('atrás com base anterior às Releases', () => {
    const r = evaluateBehind({
      lastSync: { version: null, commit: SHA, date: '2026-10-01' },
      releases,
    })
    expect(r).toMatchObject({
      title: 'Template: 2 versões atrás (base anterior às Releases → v0.3.0)',
    })
  })

  it('uma versão atrás no singular', () => {
    const r = evaluateBehind({
      lastSync: { version: 'v0.2.0', commit: SHA, date: '2026-10-01' },
      releases: [rel('v0.3.0', true)],
    })
    expect(r).toMatchObject({ title: 'Template: 1 versão atrás (v0.2.0 → v0.3.0)' })
  })

  it('em dia', () => {
    expect(
      evaluateBehind({
        lastSync: { version: 'v0.3.0', commit: SHA, date: '2026-10-01' },
        releases: [rel('v0.3.0', false)],
      })
    ).toEqual({ state: 'current' })
  })
})

describe('runCheck', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const setup = (version: string | null) => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ts-check-')))
    writeFileSync(
      join(root, '.template-sync.json'),
      JSON.stringify({
        template: 'https://github.com/owner/template',
        lastSync: { version, commit: SHA, date: '2026-10-01' },
      })
    )
  }
  const fakes = (openIssue: number | null, compare: Record<string, string> = {}) => {
    const calls: string[] = []
    const templateApi = {
      releases: async () => [
        { tag: 'v0.1.0', body: 'um' },
        { tag: 'v0.2.0', body: 'dois' },
      ],
      compareStatus: async (base: string, head: string) => {
        calls.push(`compare ${base.slice(0, 3)}...${head}`)
        return compare[head] ?? 'behind'
      },
    }
    const projectApi = {
      findOpenIssue: async (label: string) => {
        calls.push(`find ${label}`)
        return openIssue
      },
      createIssue: async (title: string, _body: string, label: string) => {
        calls.push(`create ${label} ${title}`)
      },
      updateIssue: async (n: number, title: string) => {
        calls.push(`update #${n} ${title}`)
      },
      closeIssue: async (n: number, comment: string) => {
        calls.push(`close #${n} ${comment}`)
      },
    }
    return { calls, templateApi, projectApi }
  }

  it('sem controle → no-control, sem chamadas', async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ts-check-')))
    const { calls, templateApi, projectApi } = fakes(null)
    expect(await runCheck({ root, templateApi, projectApi })).toBe('no-control')
    expect(calls).toEqual([])
  })

  it('atrás sem issue aberta → cria', async () => {
    setup('v0.1.0')
    const { calls, templateApi, projectApi } = fakes(null)
    expect(await runCheck({ root, templateApi, projectApi })).toBe('behind')
    expect(calls).toEqual([
      'find template-sync',
      'create template-sync Template: 1 versão atrás (v0.1.0 → v0.2.0)',
    ])
  })

  it('atrás com base nula usa compare e edita a issue aberta', async () => {
    setup(null)
    const { calls, templateApi, projectApi } = fakes(7, { 'v0.1.0': 'ahead', 'v0.2.0': 'ahead' })
    expect(await runCheck({ root, templateApi, projectApi })).toBe('behind')
    expect(calls).toContain('compare aaa...v0.1.0')
    expect(calls.at(-1)).toBe(
      'update #7 Template: 2 versões atrás (base anterior às Releases → v0.2.0)'
    )
  })

  it('em dia fecha a issue aberta', async () => {
    setup('v0.2.0')
    const { calls, templateApi, projectApi } = fakes(7)
    expect(await runCheck({ root, templateApi, projectApi })).toBe('current')
    expect(calls).toEqual(['find template-sync', 'close #7 Em dia com o template.'])
  })

  it('em dia sem issue não faz nada', async () => {
    setup('v0.2.0')
    const { calls, templateApi, projectApi } = fakes(null)
    expect(await runCheck({ root, templateApi, projectApi })).toBe('current')
    expect(calls).toEqual(['find template-sync'])
  })
})

describe('workflow template-sync-check.yml', () => {
  const yml = readFileSync(
    resolve(__dirname, '../../.github/workflows/template-sync-check.yml'),
    'utf8'
  )
  it('agenda semanal, sob demanda e permissões mínimas', () => {
    expect(yml).toMatch(/schedule:\s*\n\s*- cron: '0 12 \* \* 1'/)
    expect(yml).toMatch(/workflow_dispatch:/)
    const permissions = yml
      .match(/permissions:\n((?: {2}.+\n)+)/)?.[1]
      .trim()
      .split('\n')
      .map((l) => l.trim())
    expect(permissions).toEqual(['contents: read', 'issues: write'])
    expect(yml).toContain('run: node scripts/template-sync-check.mjs')
    expect(yml).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
  })
})
