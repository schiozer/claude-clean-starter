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
    expect(SKILL).toMatch(/\*\*Status\*\*: Aceito/)
    expect(SKILL).not.toMatch(/[^*]Status: Aceito/)
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

describe('skill init-project', () => {
  const SKILL = ler('init-project')

  it('frontmatter com name e description começando por Use', () => {
    const frontmatter = frontmatterDe(SKILL)
    expect(frontmatter).toMatch(/^name: init-project$/m)
    expect(frontmatter).toMatch(/^description: Use /m)
  })

  it('parte da architecture-review e só oferece o catálogo', () => {
    expect(SKILL).toMatch(/architecture-review/)
    expect(SKILL).toMatch(/stack\.catalog\.json/)
    expect(SKILL).toMatch(/só o catálogo/i)
    expect(SKILL).toMatch(/codigoDoApp/)
  })

  it('projeto novo roda os setups pelo runbook-execution, bootstrap primeiro', () => {
    expect(SKILL).toMatch(/projeto novo/i)
    expect(SKILL).toMatch(/runbook-execution/)
    expect(SKILL).toMatch(/bootstrap-ambientes\.md/)
  })

  it('projeto existente substitui o ADR e recusa o que não migra', () => {
    expect(SKILL).toMatch(/\*\*Status\*\*: Substituído por \[NNN\]/)
    expect(SKILL).toMatch(/migração não suportada/i)
    expect(SKILL).toMatch(/ADR-011/)
  })

  it('nunca mergeia', () => {
    expect(SKILL).not.toMatch(/gh pr merge/)
  })

  it('host em projeto novo: só o bloco Bootstrap pelo bootstrap-ambientes, nunca o host-<host>.md inteiro', () => {
    expect(SKILL).toMatch(/nunca o `host-<host>\.md` inteiro/)
  })

  it('desligar roda só o caminho de desligar, nunca os Passos de ligar', () => {
    expect(SKILL).toMatch(/só o caminho de desligar/)
    expect(SKILL).toMatch(/`migracao` da opção escolhida/)
  })

  it('setup com pré-condição não cumprida fica pendente no relatório', () => {
    expect(SKILL).toMatch(/setup pendente/)
  })

  it('runbook opcional apagado pelo projeto = não suportada neste projeto', () => {
    expect(SKILL).toMatch(/não suportada neste projeto/)
  })
})
