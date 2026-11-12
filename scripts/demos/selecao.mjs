// Seleção da versão publicada: qual tag, qual spec e quais cenários viram demo/treinamento.
import { parseSpecLine } from '../pr-gate.mjs'

/** @typedef {import('../e2e/cenarios.mjs').Cenario} Cenario */
/** @typedef {{ id: string, titulo: string, contexto: string, perfil: 'usuário final' | 'time interno' }} ItemSelecionado */
/** @typedef {{ versao: string, spec: string | null, demos: ItemSelecionado[], treinamento: ItemSelecionado[] }} Selecao */

export const CAMINHO_SELECAO = '.e2e/demos/selecao.json'

const TAG_SEMVER = /^v\d+\.\d+\.\d+$/

/**
 * @param {{ name: string, sha: string }[]} tags
 * @param {string} sha
 * @returns {string | null}
 */
export function tagDoCommit(tags, sha) {
  return tags.find((tag) => tag.sha === sha && TAG_SEMVER.test(tag.name))?.name ?? null
}

/**
 * @param {{
 *   tags(): Promise<{ name: string, sha: string }[]>,
 *   pullsForCommit(sha: string): Promise<{ body: string | null, merged_at: string | null, base: { ref: string } }[]>,
 * }} api
 * @param {string} tag
 * @returns {Promise<{ versao: string, sha: string, spec: string | null }>}
 */
export async function specDaTag(api, tag) {
  const encontrada = (await api.tags()).find((item) => item.name === tag)
  if (!encontrada) throw new Error(`demos: tag ${tag} não encontrada`)
  const pr = (await api.pullsForCommit(encontrada.sha)).find(
    (pull) => pull.merged_at && pull.base.ref === 'main'
  )
  const spec = pr ? parseSpecLine(pr.body ?? '') : null
  return { versao: tag, sha: encontrada.sha, spec: spec?.kind === 'path' ? spec.path : null }
}

/** Contexto a partir do ID `CT-<CTX>-NNN`. */
const contextoDe = (id) => id.split('-')[1] ?? id

/** @returns {ItemSelecionado} */
export const paraItem = (cenario) => ({
  id: cenario.id,
  titulo: cenario.titulo,
  contexto: contextoDe(cenario.id),
  perfil: cenario.perfil ?? 'usuário final',
})

/**
 * @param {{ cenarios: Cenario[], spec: string | null }} opts
 * @returns {{ demos: Cenario[], treinamento: Cenario[] }}
 */
export function selecionarCenarios({ cenarios, spec }) {
  const ativos = cenarios.filter((cenario) => !cenario.aposentado)
  const porId = (a, b) => a.id.localeCompare(b.id)
  return {
    demos: ativos
      .filter((c) => spec !== null && c.destinos.includes('@demo') && c.path === spec)
      .sort(porId),
    treinamento: ativos.filter((c) => c.destinos.includes('@treinamento')).sort(porId),
  }
}

/** @param {{ demos: { id: string }[], treinamento: { id: string }[] }} sel */
export const grepDe = (sel) =>
  [...new Set([...sel.demos, ...sel.treinamento].map((item) => item.id))].join('|')
