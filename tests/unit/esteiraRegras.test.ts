import { describe, it, expect } from 'vitest'
import { classificarPr, maiorBump, PUSHER_APP } from '../../scripts/esteira/regras.mjs'

const esteira = {
  integracao: 'develop',
  producao: 'main',
  prefixoHotfix: 'hotfix/',
  promotores: ['fulano'],
}

describe('classificarPr', () => {
  it.each([
    [{ base: 'develop', head: 'feature/x' }, 'feature'],
    [{ base: 'develop', head: 'main' }, 'back-promotion'],
    [{ base: 'main', head: 'hotfix/x' }, 'hotfix'],
    [{ base: 'main', head: 'feature/x' }, 'invalido'],
    [{ base: 'develop', head: 'hotfix/x' }, 'invalido'],
    [{ base: 'outra', head: 'feature/x' }, 'invalido'],
  ])('%j -> %s', (pr, esperado) => {
    expect(classificarPr(pr, esteira)).toBe(esperado)
  })
})

describe('maiorBump', () => {
  it('escolhe o maior', () => {
    expect(maiorBump(['fix: a', 'feat: b'], ['', ''])).toBe('minor')
    expect(maiorBump(['fix: a', 'feat!: c'], ['', ''])).toBe('major')
    expect(maiorBump(['fix: a'], [''])).toBe('patch')
    expect(maiorBump(['fix: a'], ['BREAKING CHANGE: x'])).toBe('major')
  })
  it('lista vazia é patch', () => {
    expect(maiorBump([], [])).toBe('patch')
  })
})

it('PUSHER_APP', () => {
  expect(PUSHER_APP).toBe('esteira-promover[bot]')
})
