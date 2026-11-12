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

  // R26: só arquivos inertes são semeados; os que ligam o gate viram passo de adoção explícito.
  const SEMEADOS = ['tests/e2e/auth.setup.ts', 'docs/rnf.md']
  const ATIVAM_O_GATE = ['playwright.config.ts', 'tests/e2e/cenarios.config.json']
  const AVISO_ADOCAO =
    'E2E não configurado — criar playwright.config.ts (webServer do app do projeto) e cenarios.config.json conforme docs/guides/e2e-guide.md, Adoção'

  const passo9 = () => {
    const steps = section('sync')
    return steps.slice(steps.indexOf('9. **Aplicar**'), steps.indexOf('10. **Resolver'))
  }

  it('o sync semeia só os arquivos inertes ausentes, sem sobrescrever', () => {
    const steps = section('sync')
    for (const arquivo of SEMEADOS) expect(passo9()).toContain(`\`${arquivo}\``)
    expect(steps).toMatch(/[Nn]unca sobrescreva/)
    expect(steps).toContain('test -e')
    expect(steps.indexOf('test -e')).toBeLessThan(steps.indexOf('npm run check:runbooks'))
  })

  it('o sync não semeia os arquivos que ligam o gate', () => {
    const passo = passo9()
    const recusa = passo.indexOf('**não** são semeados')
    expect(recusa).toBeGreaterThan(-1)
    for (const arquivo of ATIVAM_O_GATE) {
      expect(passo.indexOf(`\`${arquivo}\``)).toBeGreaterThan(-1)
      expect(passo.indexOf(`\`${arquivo}\``)).toBeLessThan(recusa)
    }
    expect(passo).not.toMatch(/cp <clone>\/(playwright|tests\/e2e\/cenarios)/)
  })

  it('o PR de sync lista o passo de adoção do E2E quando faltam os arquivos do gate', () => {
    expect(SKILL).toContain(AVISO_ADOCAO)
    const corpo = section('sync').slice(section('sync').indexOf('17. **Push + PR**'))
    expect(corpo).toMatch(/\*\*Adoção pendente\*\*/)
  })

  it('o adotar também semeia (segue o passo do sync)', () => {
    expect(section('adotar')).toMatch(/semeia/)
    expect(section('adotar')).toMatch(/passos 8 a 14/)
    expect(section('adotar')).not.toMatch(/semeia[^.]*playwright\.config\.ts/)
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
