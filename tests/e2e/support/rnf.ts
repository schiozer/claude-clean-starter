// Acesso ao baseline de RNF (`docs/rnf.md`) pelos testes: os valores nunca são redigitados.
import { valorEmMs } from '../../../scripts/e2e/rnf.mjs'
import { indiceAtual, type Indice } from './indice'

export type Requisito = Indice['rnf']['requisitos'][number]

/** Requisito do baseline pelo ID (`RNF-XXX-000` ou `USA-000`); falha se não existir. */
export const rnf = (id: string): Requisito => {
  const { rnf: baseline, config } = indiceAtual()
  const requisito = baseline.requisitos.find((r) => r.id === id)
  if (!requisito) {
    throw new Error(`rnf: ${id} não encontrado em ${config.rnf || 'docs/rnf.md'}`)
  }
  return requisito
}

/** Valor do requisito em milissegundos (só unidades de tempo). */
export const rnfMs = (id: string): number => valorEmMs(rnf(id))

/** Telas principais do baseline (rota + nome), na ordem do `docs/rnf.md`. */
export const telas = (): { rota: string; nome: string }[] =>
  indiceAtual().rnf.telas.map(({ rota, nome }) => ({ rota, nome }))

/**
 * Telas do baseline para testes que iteram sobre elas: falha se `## Telas` estiver vazio — loop
 * sobre lista vazia passaria sem testar nada.
 */
export const telasExigidas = (): { rota: string; nome: string }[] => {
  const lista = telas()
  if (lista.length === 0) {
    const { config } = indiceAtual()
    throw new Error(`rnf: nenhuma tela em ${config.rnf || 'docs/rnf.md'} (## Telas)`)
  }
  return lista
}

/** Parâmetro dos testes do baseline (`## Parâmetros dos testes` do `docs/rnf.md`); falha se faltar. */
export const parametro = (chave: string): string => {
  const { rnf: baseline, config } = indiceAtual()
  const valor = baseline.parametros[chave]
  if (valor === undefined) {
    throw new Error(
      `rnf: parâmetro '${chave}' não encontrado em ${config.rnf || 'docs/rnf.md'} (## Parâmetros dos testes)`
    )
  }
  return valor
}
