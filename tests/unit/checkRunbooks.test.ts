import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRunbook, checkCatalog, REQUIRED_RUNBOOKS } from '../../scripts/check-runbooks.mjs'

const VALID = `# Runbook: Exemplo

**Responsável**: time-plataforma
**Última verificação**: 2026-10-01
**Ambientes**: UAT, Prod

## Objetivo

Fazer algo.

## Pré-condições

- PR aberto.

## Pre-flight

1. [R0] Conferir a conta: \`gh auth status --active\`.

## Passos

1. [R1] Abrir o PR: \`gh pr create\`.
   Verificar: \`gh pr view\` mostra o PR aberto.
2. [R3] Humano: fazer o merge do PR.
   Verificar: \`gh pr view --json state\` → \`MERGED\`.

## Verificação final

- Smoke test ok.

## Rollback

1. [R2] Promover o deploy anterior.
   Verificar: a URL de Prod responde 200.

## Registro

Comentário no PR.
`

const swap = (from: string, to: string) => VALID.replace(from, to)

describe('checkRunbook', () => {
  it('runbook válido → sem erros (normal e estrito)', () => {
    expect(checkRunbook(VALID)).toEqual([])
    expect(checkRunbook(VALID, { strict: true })).toEqual([])
  })

  it('metadado ausente → erro', () => {
    expect(checkRunbook(swap('**Responsável**: time-plataforma\n', ''))).toContain(
      'metadado ausente: **Responsável**'
    )
  })

  it('ambiente inválido ou repetido → erro', () => {
    expect(checkRunbook(swap('UAT, Prod', 'UAT, Staging')).join()).toContain('Ambientes inválidos: Staging')
    expect(checkRunbook(swap('UAT, Prod', 'UAT, UAT'))).toContain('Ambientes repetidos')
  })

  it('seção ausente → erro', () => {
    expect(checkRunbook(swap('## Registro\n\nComentário no PR.\n', ''))).toContain('seção ausente: ## Registro')
  })

  it('seções fora de ordem → erro', () => {
    const moved = swap('## Objetivo\n\nFazer algo.\n\n', '') + '\n## Objetivo\n\nFazer algo.\n'
    expect(checkRunbook(moved).join()).toContain('seções fora de ordem')
  })

  it('seção duplicada → erro de ordem', () => {
    expect(checkRunbook(VALID + '\n## Objetivo\n\nDe novo.\n').join()).toContain('seções fora de ordem')
  })

  it('passo sem classe de risco → erro', () => {
    expect(checkRunbook(swap('1. [R0] Conferir', '1. Conferir')).join()).toContain(
      'passo sem classe de risco [R0]–[R3]'
    )
  })

  it('passo de Passos sem Verificar: → erro', () => {
    expect(checkRunbook(swap('   Verificar: `gh pr view` mostra o PR aberto.\n', '')).join()).toContain(
      'passo sem "Verificar:"'
    )
  })

  it('[R3] sem "Humano:" → erro', () => {
    expect(checkRunbook(swap('[R3] Humano: fazer', '[R3] Fazer')).join()).toContain(
      'passo [R3] deve começar com "[R3] Humano:"'
    )
  })

  it('seção de passos vazia → erro', () => {
    const empty = swap('1. [R2] Promover o deploy anterior.\n   Verificar: a URL de Prod responde 200.\n', 'Nada.\n')
    expect(checkRunbook(empty)).toContain('## Rollback: nenhum passo numerado')
  })

  it('Verificar: em parágrafo solto após a lista não conta para o passo', () => {
    const loose = swap(
      '1. [R2] Promover o deploy anterior.\n   Verificar: a URL de Prod responde 200.\n',
      '1. [R2] Promover o deploy anterior.\n\nVerificar: solto.\n'
    )
    expect(checkRunbook(loose).join()).toContain('passo sem "Verificar:"')
  })

  it('bloco de código com "## " e "1. " não vira seção nem passo', () => {
    const fenced = swap(
      '   Verificar: `gh pr view` mostra o PR aberto.\n',
      '   Verificar: saída abaixo.\n   ```\n## Nao e secao\n1. nao e passo\n   ```\n'
    )
    expect(checkRunbook(fenced)).toEqual([])
  })

  it('CRLF → mesmas regras', () => {
    expect(checkRunbook(VALID.replace(/\n/g, '\r\n'))).toEqual([])
  })

  it('não-estrito aceita <preencher; estrito rejeita com a linha', () => {
    const ph = swap('time-plataforma', '<preencher: time>')
    expect(checkRunbook(ph)).toEqual([])
    expect(checkRunbook(ph, { strict: true })).toContain('linha 3: placeholder <preencher> pendente')
  })

  it.each(['AAAA-MM-DD', '2026-13-45', '2026-02-30', '01/10/2026'])(
    'estrito rejeita data inválida %s sem lançar',
    (date) => {
      const errors = checkRunbook(swap('2026-10-01', date), { strict: true })
      expect(errors).toContain(`Última verificação inválida: "${date}" (use AAAA-MM-DD)`)
    }
  )
})

describe('checkCatalog', () => {
  let dir: string
  const writeAll = () => {
    writeFileSync(join(dir, 'README.md'), '# Runbooks\n')
    writeFileSync(join(dir, '_TEMPLATE.md'), '# Runbook: <preencher>\n')
    for (const f of REQUIRED_RUNBOOKS) writeFileSync(join(dir, f), VALID)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runbooks-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('catálogo completo e válido → sem erros (README e _TEMPLATE não são validados)', () => {
    writeAll()
    expect(checkCatalog(dir, { strict: true })).toEqual([])
  })

  it('runbook obrigatório ausente → erro', () => {
    writeAll()
    rmSync(join(dir, 'rollback.md'))
    expect(checkCatalog(dir)).toContain('rollback.md: arquivo obrigatório ausente do catálogo')
  })

  it('runbook extra inválido → erro com o nome do arquivo', () => {
    writeAll()
    writeFileSync(join(dir, 'extra.md'), '# Runbook: extra\n')
    expect(checkCatalog(dir)).toContain('extra.md: metadado ausente: **Responsável**')
  })

  it('diretório inexistente → erro', () => {
    expect(checkCatalog(join(dir, 'nao-existe'))[0]).toContain('diretório de runbooks não encontrado')
  })
})
