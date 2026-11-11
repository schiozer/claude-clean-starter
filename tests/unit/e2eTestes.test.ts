import { describe, it, expect } from 'vitest'
import { scanTestes } from '../../scripts/e2e/testes.mjs'

const SRC = `
test('CT-RES-003 publicar', { tag: ['@e2e', '@regressao'] }, async ({ page }) => {
  await jornada('CT-RES-003', {
    'Dado que estou logado': async () => {},
    'abro a lista de recursos': async () => {},
  }, { page })
})
test('RNF-SEG-001 headers', { tag: '@rnf' }, async () => {})
test('sem id', async () => {})
`

const comJornada = (chave: string) => `
test('CT-RES-003 publicar', { tag: '@e2e' }, async ({ page }) => {
  await jornada('CT-RES-003', {
    'um passo literal': async () => {},
    ${chave},
  }, { page })
})
`

describe('scanTestes', () => {
  it('extrai id, tags e passos normalizados', () => {
    const { refs, erros } = scanTestes(SRC, 'a.spec.ts')
    expect(erros).toEqual([])
    expect(refs).toEqual([
      expect.objectContaining({
        id: 'CT-RES-003',
        titulo: 'CT-RES-003 publicar',
        tags: ['@e2e', '@regressao'],
        passos: ['que estou logado', 'abro a lista de recursos'],
        path: 'a.spec.ts',
        linha: 2,
      }),
      expect.objectContaining({ id: 'RNF-SEG-001', tags: ['@rnf'], passos: null, linha: 8 }),
    ])
  })

  it('reconhece test.describe, USA e título com template sem substituição', () => {
    const { refs } = scanTestes(
      "test.describe(`USA-004 fluxo`, { tag: ['@usabilidade'] }, () => {})",
      'b.spec.ts'
    )
    expect(refs).toEqual([expect.objectContaining({ id: 'USA-004', tags: ['@usabilidade'] })])
  })

  it.each(['[`x${y}`]: f', '[k]: f', '...outros'])(
    'chave não literal (%s) → erro "chave de passo não literal"',
    (chave) => {
      const { refs, erros } = scanTestes(comJornada(chave), 'c.spec.ts')
      expect(erros).toHaveLength(1)
      expect(erros[0].mensagem).toContain('chave de passo não literal')
      expect(erros[0]).toMatchObject({ path: 'c.spec.ts', linha: 5 })
      expect(refs[0].passos).toEqual(['um passo literal'])
    }
  )

  it('jornada com ID diferente do título → erro', () => {
    const src = `test('CT-RES-003 x', async () => {
  await jornada('CT-RES-004', { 'a': f }, {})
})`
    const { erros } = scanTestes(src, 'd.spec.ts')
    expect(erros).toEqual([
      expect.objectContaining({
        path: 'd.spec.ts',
        linha: 2,
        mensagem: expect.stringContaining('CT-RES-004'),
      }),
    ])
  })

  it('dois testes com o mesmo ID no arquivo → ambos aparecem', () => {
    const src = `test('CT-RES-003 a', async () => {})\ntest('CT-RES-003 b', async () => {})`
    const { refs, erros } = scanTestes(src, 'e.spec.ts')
    expect(erros).toEqual([])
    expect(refs.map((r) => r.id)).toEqual(['CT-RES-003', 'CT-RES-003'])
  })

  it('jornada sem objeto literal de passos → erro, sem lançar', () => {
    const src = `test('CT-RES-003 a', async () => { await jornada('CT-RES-003', passos, {}) })`
    const { erros } = scanTestes(src, 'f.spec.ts')
    expect(erros[0].mensagem).toContain('chave de passo não literal')
  })

  it('não lança com código inválido', () => {
    expect(() => scanTestes('test(((', 'g.spec.ts')).not.toThrow()
  })
})
