// Catálogo de vídeos das demos/treinamento: armazenamento (Bunny Storage e um fake em memória)
// e montagem do índice. Mensagens de erro nunca incluem a senha, só método, caminho e status.

/**
 * @typedef {{
 *   ler(caminho: string): Promise<string | null>,
 *   gravar(caminho: string, conteudo: string): Promise<void>,
 * }} IArmazenamento
 */

/** @typedef {{ desktop?: string, mobile?: string }} VideosDoCenario videoIds */

/**
 * @typedef {{
 *   id: string,
 *   titulo: string,
 *   contexto: string,
 *   perfil: 'usuário final' | 'time interno',
 *   videos: VideosDoCenario,
 * }} ItemDoCatalogo
 */

/**
 * @typedef {{
 *   formato: 1,
 *   versao: string,
 *   geradoEm: string,
 *   libraryId: string,
 *   spec: string | null,
 *   demos: ItemDoCatalogo[],
 * }} CatalogoVersao
 */

/**
 * @typedef {{
 *   formato: 1,
 *   atualizadoEm: string,
 *   libraryId: string,
 *   versoes: string[],
 *   demos: Record<string, ItemDoCatalogo & { versao: string }>,
 *   treinamento: {
 *     versao: string,
 *     trilhas: { perfil: string, itens: ItemDoCatalogo[] }[],
 *   } | null,
 * }} CatalogoIndice
 */

export const CAMINHO_INDICE = 'catalogo/index.json'

/** @param {string} versao */
export const caminhoDaVersao = (versao) => `catalogo/${versao}.json`

const ORDEM_PERFIL = ['usuário final', 'time interno']

/**
 * @param {{ zona: string, senha: string, host?: string, fetchFn?: typeof fetch }} opts
 * @returns {IArmazenamento}
 */
export function makeBunnyStorage({
  zona,
  senha,
  host = 'storage.bunnycdn.com',
  fetchFn = globalThis.fetch,
}) {
  const url = (caminho) => `https://${host}/${zona}/${caminho}`
  const fail = (metodo, caminho, response) =>
    new Error(`bunny-storage: ${metodo} ${caminho} → ${response.status}`)

  return {
    async ler(caminho) {
      const response = await fetchFn(url(caminho), { method: 'GET', headers: { AccessKey: senha } })
      if (response.status === 404) return null
      if (!response.ok) throw fail('GET', caminho, response)
      return response.text()
    },

    async gravar(caminho, conteudo) {
      const response = await fetchFn(url(caminho), {
        method: 'PUT',
        headers: { AccessKey: senha, 'content-type': 'application/json' },
        body: conteudo,
      })
      if (!response.ok) throw fail('PUT', caminho, response)
    },
  }
}

/**
 * Fake em memória; `ops` registra `ler:<caminho>` e `gravar:<caminho>` na ordem.
 * @returns {IArmazenamento & { ops: string[], arquivos: Map<string, string> }}
 */
export function makeFakeStorage() {
  /** @type {string[]} */
  const ops = []
  /** @type {Map<string, string>} */
  const arquivos = new Map()
  return {
    ops,
    arquivos,
    async ler(caminho) {
      ops.push(`ler:${caminho}`)
      return arquivos.get(caminho) ?? null
    },
    async gravar(caminho, conteudo) {
      ops.push(`gravar:${caminho}`)
      arquivos.set(caminho, conteudo)
    },
  }
}

/**
 * @param {string | null} texto
 * @returns {CatalogoIndice | null} null para ausente, JSON inválido ou formato desconhecido
 */
export function lerIndice(texto) {
  if (!texto) return null
  try {
    const dados = JSON.parse(texto)
    return dados && typeof dados === 'object' && dados.formato === 1 ? dados : null
  } catch {
    return null
  }
}

const parseSemver = (versao) =>
  versao
    .replace(/^v/, '')
    .split('.')
    .map((parte) => Number.parseInt(parte, 10) || 0)

/** Comparador SemVer decrescente (`vX.Y.Z`). */
const compararSemverDesc = (a, b) => {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const posicaoDoPerfil = (perfil) => {
  const pos = ORDEM_PERFIL.indexOf(perfil)
  return pos === -1 ? ORDEM_PERFIL.length : pos
}

const montarTrilhas = (itens) => {
  /** @type {Map<string, ItemDoCatalogo[]>} */
  const porPerfil = new Map()
  for (const item of itens)
    porPerfil.set(item.perfil, [...(porPerfil.get(item.perfil) ?? []), item])
  return [...porPerfil]
    .sort(([a], [b]) => posicaoDoPerfil(a) - posicaoDoPerfil(b))
    .map(([perfil, lista]) => ({
      perfil,
      itens: [...lista].sort((a, b) => a.id.localeCompare(b.id)),
    }))
}

/**
 * @param {{
 *   anterior: CatalogoIndice | null,
 *   versao: CatalogoVersao,
 *   treinamento: ItemDoCatalogo[],
 *   agora: Date,
 * }} opts
 * @returns {CatalogoIndice}
 */
export function montarIndice({ anterior, versao, treinamento, agora }) {
  const versoes = [...new Set([...(anterior?.versoes ?? []), versao.versao])].sort(
    compararSemverDesc
  )
  const demos = { ...(anterior?.demos ?? {}) }
  for (const demo of versao.demos) demos[demo.id] = { ...demo, versao: versao.versao }
  return {
    formato: 1,
    atualizadoEm: agora.toISOString(),
    libraryId: versao.libraryId,
    versoes,
    demos,
    treinamento: { versao: versao.versao, trilhas: montarTrilhas(treinamento) },
  }
}
