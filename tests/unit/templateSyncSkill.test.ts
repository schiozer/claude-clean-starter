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

  const section = (mode: string) => SKILL.split(`## Modo \`${mode}\``)[1]?.split('\n## ')[0] ?? ''

  it.each(['sync', 'adotar'])(
    'o modo %s cria a feature branch no projeto antes do plano',
    (mode) => {
      const steps = section(mode)
      expect(steps).toMatch(/switch -c chore\/template-sync-/)
      expect(steps.indexOf('switch -c')).toBeLessThan(steps.indexOf('template-sync.mjs plan'))
    }
  )

  const SEMEADOS = [
    'playwright.config.ts',
    'tests/e2e/cenarios.config.json',
    'tests/e2e/auth.setup.ts',
    'docs/rnf.md',
  ]

  it('o sync semeia os arquivos do projeto ausentes, sem sobrescrever', () => {
    const steps = section('sync')
    for (const arquivo of SEMEADOS) expect(steps).toContain(`\`${arquivo}\``)
    expect(steps).toMatch(/[Nn]unca sobrescreva/)
    expect(steps).toContain('test -e')
    expect(steps.indexOf('test -e')).toBeLessThan(steps.indexOf('npm run check:runbooks'))
  })

  it('o adotar também semeia (segue o passo do sync)', () => {
    expect(section('adotar')).toMatch(/semeia/)
    expect(section('adotar')).toMatch(/passos 8 a 14/)
  })

  it('a skill explica o conflito binário', () => {
    expect(section('sync')).toMatch(/`binary`/)
  })

  it('gh pr merge só aparece como proibição', () => {
    const lines = SKILL.split('\n').filter((line) => line.includes('gh pr merge'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatch(/[Nn]unca/)
  })
})
