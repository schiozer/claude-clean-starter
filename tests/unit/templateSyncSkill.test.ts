import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SKILL = readFileSync(resolve('.claude/skills/template-sync/SKILL.md'), 'utf8')
const frontmatter = SKILL.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? ''

describe('skill template-sync', () => {
  it('frontmatter com name e description começando por Use', () => {
    expect(frontmatter).toMatch(/^name: template-sync$/m)
    expect(frontmatter).toMatch(/^description: Use /m)
  })

  it.each(['sync', 'adotar', 'contribuir', 'status'])('cita o modo %s', (mode) => {
    expect(SKILL).toMatch(new RegExp(`## Modo \`${mode}\``))
  })

  it.each([
    'plan',
    'apply',
    'finish',
    'latest',
    'propose-base',
    'inventory',
    'rewrite-links',
    'check-agnostic',
  ])('cita o subcomando %s', (command) => {
    expect(SKILL).toContain(`template-sync.mjs ${command}`)
  })

  it('gh pr merge só aparece como proibição', () => {
    const lines = SKILL.split('\n').filter((line) => line.includes('gh pr merge'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatch(/[Nn]unca/)
  })
})
