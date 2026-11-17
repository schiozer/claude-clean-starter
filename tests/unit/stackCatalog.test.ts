import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { HOSTS } from '../../scripts/deploy/config.mjs'
import { lerCatalog, parseCatalog } from '../../scripts/stack/catalog.mjs'

const catalog = lerCatalog()
const DIMENSOES = ['perfil', 'formato', 'host', 'banco', 'auth', 'mcp', 'video', 'specGate', 'e2e']

type Opcao = {
  id: string
  recomendada: boolean
  pros: string[]
  contras: string[]
  adr: string
  setup: string | null
  migracao: string | null
  codigoDoApp: Record<string, string[]>
}
type Dimensao = { id: string; grava: unknown; opcoes: Opcao[] }

const dimensoes = catalog.dimensoes as Dimensao[]
const dimensao = (id: string) => dimensoes.find((d) => d.id === id) as Dimensao
const recomendada = (id: string) => dimensao(id).opcoes.find((o) => o.recomendada)?.id

describe('stack.catalog.json', () => {
  it('tem as 9 dimensões na ordem', () => {
    expect(dimensoes.map((d) => d.id)).toEqual(DIMENSOES)
  })

  it('todo adr, setup e migracao existe', () => {
    for (const d of dimensoes) {
      for (const o of d.opcoes) {
        for (const p of [o.adr, o.setup, o.migracao]) {
          if (p !== null) expect(existsSync(resolve(p)), p).toBe(true)
        }
      }
    }
  })

  it('no máximo uma recomendada por dimensão; perfil sem recomendada', () => {
    for (const d of dimensoes) {
      expect(d.opcoes.filter((o) => o.recomendada).length, d.id).toBeLessThanOrEqual(1)
    }
    expect(recomendada('perfil')).toBeUndefined()
  })

  it('recomendação base vercel + neon + auth0', () => {
    expect([recomendada('host'), recomendada('banco'), recomendada('auth')]).toEqual([
      'vercel',
      'neon',
      'auth0',
    ])
  })

  it('recomendadas de formato, mcp, video, specGate, e2e', () => {
    expect(['formato', 'mcp', 'video', 'specGate', 'e2e'].map(recomendada)).toEqual([
      'next-monolito',
      'ligado',
      'nenhum',
      'off',
      'playwright',
    ])
  })

  it('toda opção tem pros e contras (contras vazio só em dimensão de opção única)', () => {
    for (const d of dimensoes) {
      for (const o of d.opcoes) {
        expect(o.pros.length, `${d.id}.${o.id}`).toBeGreaterThan(0)
        if (d.opcoes.length > 1) expect(o.contras.length, `${d.id}.${o.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('hosts do catálogo = HOSTS', () => {
    expect(
      dimensao('host')
        .opcoes.map((o) => o.id)
        .sort()
    ).toEqual([...HOSTS].sort())
  })

  it('ids únicos por dimensão', () => {
    for (const d of dimensoes) {
      const ids = d.opcoes.map((o) => o.id)
      expect(new Set(ids).size, d.id).toBe(ids.length)
    }
  })

  it('grava de perfil, host, video e specGate', () => {
    expect(dimensao('perfil').grava).toEqual({ arquivo: 'CLAUDE.md', campo: 'Perfil arquitetural' })
    expect(dimensao('host').grava).toEqual({ arquivo: 'deploy.config.json', campo: 'host' })
    expect(dimensao('video').grava).toEqual({ 'gh-variable': 'DEMOS_BUNNY' })
    expect(dimensao('specGate').grava).toEqual({ 'gh-variable': 'SPEC_GATE' })
    for (const id of ['formato', 'banco', 'auth', 'mcp', 'e2e']) {
      expect(dimensao(id).grava, id).toBe('nenhum')
    }
  })

  it('heroku em expo-api lista código do app', () => {
    const heroku = dimensao('host').opcoes.find((o) => o.id === 'heroku') as Opcao
    expect(heroku.codigoDoApp['expo-api'].some((item) => /Procfile/.test(item))).toBe(true)
  })
})

const opcao = {
  id: 'a',
  nome: 'A',
  recomendada: true,
  porque: 'x',
  pros: ['p'],
  contras: [],
  adr: 'ARCHITECTURE.md',
  setup: null,
  migracao: null,
  codigoDoApp: {},
}
const com = (o: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    versao: 1,
    dimensoes: [{ id: 'd', nome: 'D', grava: 'nenhum', opcoes: [{ ...opcao, ...o }] }],
    ...extra,
  })

describe('parseCatalog', () => {
  it('aceita catálogo mínimo válido', () => {
    expect(parseCatalog(com({})).dimensoes[0].opcoes[0].id).toBe('a')
  })

  it.each([
    ['JSON malformado', '{'],
    ['sem dimensoes', '{"versao":1}'],
    ['dimensoes vazio', '{"versao":1,"dimensoes":[]}'],
    ['opção sem pros', com({ pros: undefined })],
    ['recomendada não booleana', com({ recomendada: 'sim' })],
    ['migracao numérica', com({ migracao: 1 })],
    ['versao 2', com({}, { versao: 2 })],
    [
      'grava inválido',
      JSON.stringify({
        versao: 1,
        dimensoes: [{ id: 'd', nome: 'D', grava: 'x', opcoes: [opcao] }],
      }),
    ],
  ])('%s → erro de catálogo', (_nome, texto) => {
    expect(() => parseCatalog(texto)).toThrow(/Catálogo de stack inválido/)
  })
})
