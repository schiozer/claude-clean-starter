// `jornada()`: executa um cenário da spec passo a passo (spec e2e-regressao-docs §7.1). Os passos
// não são redigitados no teste: o texto vem da spec e cada `test.step` chama a implementação cuja
// chave é aquele passo. A comparação das chaves é a mesma do `check-cenarios` (`diffPassos`).
import { test, type Page } from '@playwright/test'
import { diffPassos, normalizarPasso } from '../../../scripts/e2e/cenarios.mjs'
import { indiceAtual, type Cenario } from './indice'

export type Passos = Record<string, () => Promise<void>>

export interface PassoCtx {
  id: string
  /** Posição do passo no cenário, a partir de 0. */
  indice: number
  /** Palavra inicial da spec (`Dado`, `Quando`, `Então`, `E`, `Mas`). */
  palavra: string
  /** Texto do passo na spec, sem a palavra inicial. */
  texto: string
  cenario: Cenario
  page?: Page
}

export type GanchoDePasso = (ctx: PassoCtx) => Promise<void>

export type MomentoDoGancho = 'antes' | 'depois'

const ganchos: Record<MomentoDoGancho, GanchoDePasso[]> = { antes: [], depois: [] }

/**
 * Registra um gancho chamado em cada passo de toda `jornada()`: por padrão após o passo
 * (`'depois'`, ex.: screenshot da doc); com `momento: 'antes'`, antes dele (ex.: legenda do vídeo).
 * @returns função que remove o gancho.
 */
export const registrarGanchoDePasso = (
  fn: GanchoDePasso,
  opts: { momento?: MomentoDoGancho } = {}
): (() => void) => {
  const lista = ganchos[opts.momento ?? 'depois']
  lista.push(fn)
  return () => {
    const i = lista.indexOf(fn)
    if (i >= 0) lista.splice(i, 1)
  }
}

export const jornada = async (
  id: string,
  passos: Passos,
  opts: { page?: Page } = {}
): Promise<void> => {
  const cenario = indiceAtual().cenarios.get(id)
  if (!cenario) {
    throw new Error(
      `jornada: cenário ${id} não encontrado nas specs (confira o ID no título do teste e a seção "Cenários de teste" da spec)`
    )
  }
  const chaves = Object.keys(passos)
  const porNormalizado = new Map(chaves.map((k) => [normalizarPasso(k), passos[k]]))
  const diff = diffPassos(
    cenario.passos.map((p) => normalizarPasso(p.texto)),
    chaves.map(normalizarPasso)
  )
  if (diff) {
    throw new Error(
      `jornada: passos de ${id} diferem de ${cenario.path}:${cenario.linha} — ${diff}`
    )
  }

  for (const [indice, passo] of cenario.passos.entries()) {
    const executar = porNormalizado.get(normalizarPasso(passo.texto))
    if (!executar) throw new Error(`jornada: passo sem implementação em ${id}: "${passo.texto}"`)
    await test.step(`${passo.palavra} ${passo.texto}`, async () => {
      const ctx: PassoCtx = { id, indice, palavra: passo.palavra, texto: passo.texto, cenario }
      if (opts.page) ctx.page = opts.page
      for (const gancho of [...ganchos.antes]) await gancho(ctx)
      await executar()
      for (const gancho of [...ganchos.depois]) await gancho(ctx)
    })
  }
}
