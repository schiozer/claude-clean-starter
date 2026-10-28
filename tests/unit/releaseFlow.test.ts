import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkPr } from '../../scripts/pr-gate.mjs'
import { evaluateGates } from '../../scripts/main-guard.mjs'
import { runRelease } from '../../scripts/release.mjs'

// Fluxo ponta a ponta: template de PR preenchido → PR gate → guarda da main → release.
const ROOT = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')
const config = JSON.parse(read('hooks/protect-main/config.json'))

// Spec fictícia: as specs do template não vão para os projetos derivados (template-sync).
const SPEC = 'docs/superpowers/specs/2026-01-01-exemplo-design.md'
const TITLE = 'feat(release): versão por merge'
const HEAD = 'd'.repeat(40)
const AFTER = 'a'.repeat(40)
const BEFORE = 'b'.repeat(40)
const PR_URL = 'https://github.com/o/r/pull/42'
const TICKED = ['- [', 'x', '] UAT aprovado'].join('')

const fillTemplate = () =>
  read('.github/pull_request_template.md')
    .replace('Spec: <caminho ou n/a — motivo>', `Spec: ${SPEC}`)
    .replace(
      /^\|\s+\|\s+\|\s+\|$/m,
      '| PR gate valida o título | scripts/pr-gate.mjs, tests/unit/prGate.test.ts | ok |'
    )
    .replace('- [ ] UAT aprovado', TICKED)

const success = (name: string, id: number) => ({
  name,
  status: 'completed',
  conclusion: 'success',
  id,
})

describe('fluxo de release ponta a ponta', () => {
  const body = fillTemplate()
  const checkRuns = [
    ...config.requiredChecks.map((name: string, index: number) => success(name, index + 1)),
    { name: config.specGateCheck, status: 'completed', conclusion: 'skipped', id: 99 },
  ]
  const pr = {
    number: 42,
    html_url: PR_URL,
    title: TITLE,
    body,
    merged_at: '2026-10-25T12:00:00Z',
    base: { ref: 'main' },
    head: { sha: HEAD },
  }

  it('o template preenchido passa no PR gate (edited)', () => {
    expect(body).toContain(TICKED)
    const errors = checkPr({
      title: TITLE,
      body,
      action: 'edited',
      fileExists: (path: string) => path === SPEC,
    })
    expect(errors).toEqual([])
  })

  it('a guarda não acha gate faltando com SPEC_GATE desligado', () => {
    const missing = evaluateGates(pr, {
      checkRuns,
      parents: ['p'.repeat(40)],
      requiredChecks: config.requiredChecks,
    })
    expect(missing).toEqual([])
  })

  it('o release cria a versão minor com PR e Spec × código pulado', async () => {
    const api = {
      tags: vi.fn(async () => [{ name: 'v1.2.3', sha: BEFORE }]),
      pullsForCommit: vi.fn(async () => [pr]),
      commitMessage: vi.fn(async () => TITLE),
      compare: vi.fn(async () => [AFTER]),
      checkRuns: vi.fn(async () => checkRuns),
      releaseExists: vi.fn(async () => false),
      createTag: vi.fn(async () => undefined),
      createRelease: vi.fn(async () => undefined),
    }
    const result = await runRelease({ before: BEFORE, after: AFTER }, api, {
      packageVersion: '0.1.0',
      specGateCheck: config.specGateCheck,
      delayMs: 0,
    })
    expect(result).toEqual({ created: true, tag: 'v1.3.0' })
    expect(api.createTag).toHaveBeenCalledWith('v1.3.0', AFTER, TITLE)
    const [tag, name, notes] = api.createRelease.mock.calls[0] as unknown as string[]
    expect(tag).toBe('v1.3.0')
    expect(name).toBe(`v1.3.0 — ${TITLE}`)
    expect(notes).toContain(`[#42](${PR_URL})`)
    expect(notes).toContain('Spec × código: pulado')
    expect(notes).toContain(`https://github.com/o/r/blob/v1.3.0/${SPEC}`)
    expect(notes).toContain('UAT: aprovado')
  })
})
