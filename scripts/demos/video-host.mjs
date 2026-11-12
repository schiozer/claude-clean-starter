// Porta de hospedagem de vídeo das demos/treinamento (IVideoHost): Bunny Stream e um fake em
// memória para os testes. Mensagens de erro nunca incluem a AccessKey, só método, caminho e status.
import { promises as fs } from 'node:fs'

/**
 * @typedef {{
 *   ensureCollection(nome: string): Promise<{ id: string }>,
 *   replaceCollection<T>(nome: string, preencher: (id: string) => Promise<T>): Promise<T>,
 *   upload(input: { colecao: string, titulo: string, arquivo: string }): Promise<{ videoId: string }>,
 *   embedUrl(videoId: string): string,
 * }} IVideoHost
 */

const PAGE_SIZE = 100
const embedUrlFor = (libraryId, videoId) =>
  `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}`

/**
 * @param {{
 *   apiKey: string,
 *   libraryId: string,
 *   fetchFn?: typeof fetch,
 *   readFile?: (path: string) => Promise<Uint8Array>,
 * }} opts
 * @returns {IVideoHost}
 */
export function makeBunnyStreamVideoHost({
  apiKey,
  libraryId,
  fetchFn = globalThis.fetch,
  readFile = fs.readFile,
}) {
  const base = `https://video.bunnycdn.com/library/${libraryId}`

  /** JSON da resposta (`null` se vazio). HTTP != 2xx lança Error sem a chave. */
  const call = async (method, path, { json, bytes } = {}) => {
    const headers = { AccessKey: apiKey }
    if (json) headers['content-type'] = 'application/json'
    if (bytes) headers['content-type'] = 'application/octet-stream'
    const response = await fetchFn(`${base}${path}`, {
      method,
      headers,
      body: json ? JSON.stringify(json) : bytes,
    })
    if (!response.ok) {
      throw new Error(`bunny-stream: ${method} /library/${libraryId}${path} → ${response.status}`)
    }
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }

  const findCollections = async (nome) => {
    const page = await call(
      'GET',
      `/collections?search=${encodeURIComponent(nome)}&itemsPerPage=${PAGE_SIZE}`
    )
    return (page?.items ?? []).filter((item) => item.name === nome)
  }

  const createCollection = async (nome) => {
    const created = await call('POST', '/collections', { json: { name: nome } })
    return { id: created.guid }
  }

  const listVideos = async (colecao, titulo) => {
    const search = titulo === undefined ? '' : `&search=${encodeURIComponent(titulo)}`
    const page = await call(
      'GET',
      `/videos?collection=${encodeURIComponent(colecao)}${search}&itemsPerPage=${PAGE_SIZE}`
    )
    return page?.items ?? []
  }

  const deleteCollectionWithVideos = async (id) => {
    for (const video of await listVideos(id)) await call('DELETE', `/videos/${video.guid}`)
    await call('DELETE', `/collections/${id}`)
  }

  return {
    async ensureCollection(nome) {
      const [existing] = await findCollections(nome)
      return existing ? { id: existing.guid } : createCollection(nome)
    },

    async replaceCollection(nome, preencher) {
      const antigas = await findCollections(nome)
      const nova = await createCollection(nome)
      let result
      try {
        result = await preencher(nova.id)
      } catch (error) {
        await deleteCollectionWithVideos(nova.id)
        throw error
      }
      for (const antiga of antigas) await deleteCollectionWithVideos(antiga.guid)
      return result
    },

    async upload({ colecao, titulo, arquivo }) {
      const created = await call('POST', '/videos', {
        json: { title: titulo, collectionId: colecao },
      })
      await call('PUT', `/videos/${created.guid}`, { bytes: await readFile(arquivo) })
      // Upsert: só depois do envio bem-sucedido some a versão anterior do mesmo título.
      const antigos = (await listVideos(colecao, titulo)).filter(
        (video) => video.title === titulo && video.guid !== created.guid
      )
      for (const antigo of antigos) await call('DELETE', `/videos/${antigo.guid}`)
      return { videoId: created.guid }
    },

    embedUrl: (videoId) => embedUrlFor(libraryId, videoId),
  }
}

/**
 * Fake em memória com a mesma semântica; `ops` registra a ordem das operações.
 * @param {{ libraryId?: string }} [opts]
 * @returns {IVideoHost & {
 *   ops: string[],
 *   colecoes: Map<string, { nome: string, videos: Map<string, string> }>,
 * }}
 */
export function makeFakeVideoHost({ libraryId = 'lib-fake' } = {}) {
  /** @type {string[]} */
  const ops = []
  /** @type {Map<string, { nome: string, videos: Map<string, string> }>} */
  const colecoes = new Map()
  let colSeq = 0
  let vidSeq = 0

  const create = (nome) => {
    const id = `col-${++colSeq}`
    colecoes.set(id, { nome, videos: new Map() })
    ops.push(`create:${nome}`)
    return { id }
  }

  const remove = (id) => {
    const colecao = colecoes.get(id)
    if (!colecao) return
    for (const titulo of colecao.videos.values()) ops.push(`delete-video:${titulo}`)
    colecao.videos.clear()
    colecoes.delete(id)
    ops.push(`delete-collection:${colecao.nome}`)
  }

  const idsByName = (nome) =>
    [...colecoes].filter(([, colecao]) => colecao.nome === nome).map(([id]) => id)

  return {
    ops,
    colecoes,

    async ensureCollection(nome) {
      ops.push(`ensure:${nome}`)
      const [id] = idsByName(nome)
      return id ? { id } : create(nome)
    },

    async replaceCollection(nome, preencher) {
      const antigas = idsByName(nome)
      const nova = create(nome)
      let result
      try {
        result = await preencher(nova.id)
      } catch (error) {
        remove(nova.id)
        throw error
      }
      for (const id of antigas) remove(id)
      return result
    },

    async upload({ colecao, titulo }) {
      const alvo = colecoes.get(colecao)
      if (!alvo) throw new Error(`fake-video-host: coleção ${colecao} inexistente`)
      const videoId = `vid-${++vidSeq}`
      alvo.videos.set(videoId, titulo)
      ops.push(`upload:${alvo.nome}:${titulo}`)
      for (const [id, existente] of [...alvo.videos]) {
        if (existente !== titulo || id === videoId) continue
        alvo.videos.delete(id)
        ops.push(`delete-video:${titulo}`)
      }
      return { videoId }
    },

    embedUrl: (videoId) => embedUrlFor(libraryId, videoId),
  }
}
