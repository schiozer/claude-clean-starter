import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONTROL_PATH,
  parseControl,
  readControl,
  writeControl,
} from '../../scripts/template-sync/control.mjs'

const SHA = 'a'.repeat(40)
const valid = () => ({
  template: 'https://github.com/<owner>/claude-clean-starter',
  lastSync: { version: 'v0.2.0', commit: SHA, date: '2026-10-27' },
  projectOwned: [],
})

describe('parseControl', () => {
  it('aceita o exemplo da spec e version null', () => {
    expect(parseControl(valid())).toEqual(valid())
    const nullVersion = { ...valid(), lastSync: { ...valid().lastSync, version: null } }
    expect(parseControl(nullVersion).lastSync.version).toBeNull()
  })

  it.each([
    ['lastSync.version', { lastSync: { version: '0.2', commit: SHA, date: '2026-10-27' } }],
    ['lastSync.commit', { lastSync: { version: 'v0.2.0', commit: 'abc', date: '2026-10-27' } }],
    ['lastSync.date', { lastSync: { version: 'v0.2.0', commit: SHA, date: '27/10/2026' } }],
    ['projectOwned', { projectOwned: 'x' }],
    ['template', { template: 'git@github.com:o/r.git' }],
  ])('rejeita %s inválido', (field, patch) => {
    expect(() => parseControl({ ...valid(), ...patch })).toThrow(
      new RegExp(`\\.template-sync\\.json inválido: ${field.replace('.', '\\.')}`)
    )
  })

  it('rejeita não-objeto', () => {
    expect(() => parseControl([])).toThrow(/\.template-sync\.json inválido/)
  })
})

describe('readControl / writeControl', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ts-control-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('sem arquivo devolve null', () => {
    expect(readControl(dir)).toBeNull()
  })
  it('ida e volta', () => {
    writeControl(dir, valid())
    expect(readControl(dir)).toEqual(valid())
  })
  it('JSON quebrado vira erro claro', () => {
    writeFileSync(join(dir, CONTROL_PATH), '{')
    expect(() => readControl(dir)).toThrow(/\.template-sync\.json inválido/)
  })
})
