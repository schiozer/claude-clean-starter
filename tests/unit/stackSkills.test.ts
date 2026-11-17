import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ler = (nome: string) => readFileSync(resolve(`.claude/skills/${nome}/SKILL.md`), 'utf8')
const frontmatterDe = (skill: string) => skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? ''

describe('skill architecture-review', () => {
  const SKILL = ler('architecture-review')

  it('frontmatter com name e description começando por Use', () => {
    const frontmatter = frontmatterDe(SKILL)
    expect(frontmatter).toMatch(/^name: architecture-review$/m)
    expect(frontmatter).toMatch(/^description: Use /m)
  })

  it('acha o ADR vigente: maior NNN *-stack-tecnologica.md com Status: Aceito', () => {
    expect(SKILL).toMatch(/stack-tecnologica\.md/)
    expect(SKILL).toMatch(/Status: Aceito/)
    expect(SKILL).toMatch(/maior/)
    expect(SKILL).toMatch(/Substituído por/)
  })

  it('confere com o estado real e lê o catálogo', () => {
    expect(SKILL).toMatch(/stack\.catalog\.json/)
    expect(SKILL).toMatch(/deploy\.config\.json/)
    expect(SKILL).toMatch(/gh variable list/)
  })

  it('gera o ADR com tabela, evidência e Fora do catálogo, por PR', () => {
    expect(SKILL).toMatch(/Dimensão \| Escolha \| ADR de detalhe \| Desde/)
    expect(SKILL).toMatch(/arquivo:linha/)
    expect(SKILL).toMatch(/Fora do catálogo/)
    expect(SKILL).toMatch(/\bPR\b/)
  })

  it('nunca mergeia', () => {
    expect(SKILL).not.toMatch(/gh pr merge/)
  })
})
