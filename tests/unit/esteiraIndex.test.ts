import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { executar } from '../../scripts/esteira/index.mjs'

const CLI = resolve(__dirname, '../../scripts/esteira/index.mjs')
const ESTEIRA = {
  integracao: 'develop',
  producao: 'main',
  prefixoHotfix: 'hotfix/',
  promotores: ['fulano'],
}

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

const raizCom = (config: object | null) => {
  const raiz = mkdtempSync(join(tmpdir(), 'esteira-index-'))
  dirs.push(raiz)
  if (config) {
    mkdirSync(join(raiz, 'hooks/protect-main'), { recursive: true })
    writeFileSync(join(raiz, 'hooks/protect-main/config.json'), JSON.stringify(config))
  }
  return raiz
}

describe('executar ativa', () => {
  it('com esteira: ativa=true e as branches de integração e produção', () => {
    const raiz = raizCom({ protectedBranches: ['main'], esteira: ESTEIRA })
    expect(executar('ativa', { raiz })).toEqual({
      ativa: 'true',
      integracao: 'develop',
      producao: 'main',
    })
  })

  it('sem o bloco esteira: ativa=false (como hoje)', () => {
    const raiz = raizCom({ protectedBranches: ['main'] })
    expect(executar('ativa', { raiz })).toEqual({ ativa: 'false', integracao: '', producao: '' })
  })

  it('sem hooks/protect-main/config.json: ativa=false', () => {
    expect(executar('ativa', { raiz: raizCom(null) })).toEqual({
      ativa: 'false',
      integracao: '',
      producao: '',
    })
  })

  it('bloco esteira inválido falha (não liga a esteira pela metade)', () => {
    const raiz = raizCom({ esteira: { ...ESTEIRA, promotores: [] } })
    expect(() => executar('ativa', { raiz })).toThrow(/esteira: promotores/)
  })

  it('operação desconhecida falha listando as válidas', () => {
    expect(() => executar('outra', { raiz: raizCom(null) })).toThrow(
      "esteira: operação 'outra' inválida (válidas: ativa)"
    )
  })
})

describe('CLI node scripts/esteira/index.mjs ativa', () => {
  const rodar = (raiz: string, env: Record<string, string> = {}) =>
    execFileSync('node', [CLI, 'ativa'], {
      cwd: raiz,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
    })

  it('grava em GITHUB_OUTPUT quando definido', () => {
    const raiz = raizCom({ esteira: ESTEIRA })
    const saida = join(raiz, 'saida.txt')
    writeFileSync(saida, '')
    expect(rodar(raiz, { GITHUB_OUTPUT: saida })).toBe('')
    expect(readFileSync(saida, 'utf8')).toBe('ativa=true\nintegracao=develop\nproducao=main\n')
  })

  it('sem GITHUB_OUTPUT escreve no stdout', () => {
    expect(rodar(raizCom({ protectedBranches: ['main'] }))).toBe(
      'ativa=false\nintegracao=\nproducao=\n'
    )
  })

  it('config inválido sai com código 1 e mensagem no stderr', () => {
    const raiz = raizCom({ esteira: { ...ESTEIRA, integracao: 'main' } })
    expect(() =>
      execFileSync('node', [CLI, 'ativa'], { cwd: raiz, stdio: 'pipe', encoding: 'utf8' })
    ).toThrow(/esteira: integracao/)
  })
})
