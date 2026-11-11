import { describe, it, expect } from 'vitest'
import { parseRnf, valorEmMs } from '../../scripts/e2e/rnf.mjs'

const RNF = `# RNF

## Requisitos

| ID          | Categoria   | Requisito                  | Valor    |
| ----------- | ----------- | -------------------------- | -------- |
| RNF-TMO-001 | Timeout     | Timeout da API             | 10000 ms |
| RNF-SES-001 | Sessão      | Sessão inativa expira      | 8 h      |
| RNF-PER-009 | Performance | Sem valor numérico         | —        |
| USA-001     | Usabilidade | Botão só-ícone tem nome    | —        |
| RNF-LAR-002  | Largura     | Largura mínima             | 320 px   |

## Telas

| Rota             | Nome     |
| ---------------- | -------- |
| /                | Início   |
| /recursos        | Recursos |

## Exclusões

- /api
- /login
`

describe('parseRnf', () => {
  it('lê requisitos, telas e exclusões', () => {
    const { requisitos, telas, exclusoes, erros } = parseRnf(RNF, 'rnf.md')
    expect(erros).toEqual([])
    expect(requisitos[0]).toEqual({
      id: 'RNF-TMO-001',
      categoria: 'Timeout',
      requisito: 'Timeout da API',
      valor: { numero: 10000, unidade: 'ms' },
    })
    expect(requisitos.map((r: { id: string }) => r.id)).toEqual([
      'RNF-TMO-001',
      'RNF-SES-001',
      'RNF-PER-009',
      'USA-001',
      'RNF-LAR-002',
    ])
    expect(requisitos[3].categoria).toBe('Usabilidade')
    expect(telas).toEqual([
      { rota: '/', nome: 'Início' },
      { rota: '/recursos', nome: 'Recursos' },
    ])
    expect(exclusoes).toEqual(['/api', '/login'])
  })

  it('valorEmMs converte 8 h em 28 800 000', () => {
    const { requisitos } = parseRnf(RNF, 'rnf.md')
    expect(valorEmMs(requisitos[1])).toBe(28_800_000)
    expect(valorEmMs(requisitos[0])).toBe(10_000)
  })

  it('valorEmMs lança para px', () => {
    const { requisitos } = parseRnf(RNF, 'rnf.md')
    expect(() => valorEmMs(requisitos[4])).toThrow(/px/)
  })

  it('linha com ID inválido vira erro com linha', () => {
    const md = `## Requisitos\n\n| ID | Categoria | Requisito | Valor |\n| -- | -- | -- | -- |\n| RNF-X-1 | Timeout | Ruim | 1 s |\n`
    const { requisitos, erros } = parseRnf(md, 'rnf.md')
    expect(requisitos).toEqual([])
    expect(erros).toHaveLength(1)
    expect(erros[0]).toMatchObject({ path: 'rnf.md', linha: 5 })
    expect(erros[0].mensagem).toMatch(/ID/)
  })

  it('valor "—" vira null', () => {
    const { requisitos } = parseRnf(RNF, 'rnf.md')
    expect(requisitos[2].valor).toBeNull()
    expect(() => valorEmMs(requisitos[2])).toThrow()
  })

  it('valor em formato desconhecido vira erro com linha', () => {
    const md = `## Requisitos\n\n| ID | Categoria | Requisito | Valor |\n| -- | -- | -- | -- |\n| RNF-TMO-002 | Timeout | X | muito |\n`
    const { erros } = parseRnf(md, 'rnf.md')
    expect(erros[0]).toMatchObject({ linha: 5 })
    expect(erros[0].mensagem).toMatch(/Valor/)
  })
})
