// Porta de hospedagem de vídeo das demos/treinamento (IVideoHost): Bunny Stream e um fake em
// memória para os testes. Mensagens de erro nunca incluem a AccessKey, só método, caminho e status.
import { promises as fs } from 'node:fs'

/**
 * @typedef {{
 *   ensureCollection(nome: string): Promise<{ id: string }>,
 *   replaceCollection<T>(nome: string, preencher: (id: string) => Promise<T>): Promise<T>,
 *   upload(input: { colecao: string, titulo: string, arquivo: string }):
 *     Promise<{ videoId: string, obsoletos: string[] }>,
 *   deleteVideo(videoId: string): Promise<void>,
 *   embedUrl(videoId: string): string,
 * }} IVideoHost
 * `upload` não apaga nada: devolve em `obsoletos` os vídeos anteriores de mesmo título, que quem
 * publica apaga (`deleteVideo`) só depois de gravar o índice que deixa de apontá-los.
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
        // A falha do cleanup não pode mascarar o erro original (a coleção órfã fica no Bunny).
        try {
          await deleteCollectionWithVideos(nova.id)
        } catch {
          // ignora: relança o original abaixo
        }
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
      // Upsert: os anteriores de mesmo título viram `obsoletos`; quem publica os apaga depois.
      const obsoletos = (await listVideos(colecao, titulo))
        .filter((video) => video.title === titulo && video.guid !== created.guid)
        .map((video) => video.guid)
      return { videoId: created.guid, obsoletos }
    },

    async deleteVideo(videoId) {
      await call('DELETE', `/videos/${videoId}`)
    },

    embedUrl: (videoId) => embedUrlFor(libraryId, videoId),
  }
}

/**
 * Fake em memória com a mesma semântica; `ops` registra a ordem das operações.
 * `falharAoApagarColecao` simula falha no cleanup de coleção (testes).
 * @param {{ libraryId?: string, falharAoApagarColecao?: boolean }} [opts]
 * @returns {IVideoHost & {
 *   ops: string[],
 *   colecoes: Map<string, { nome: string, videos: Map<string, string> }>,
 * }}
 */
export function makeFakeVideoHost({ libraryId = 'lib-fake', falharAoApagarColecao = false } = {}) {
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
    if (falharAoApagarColecao) throw new Error('fake-video-host: falha ao apagar coleção')
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
        try {
          remove(nova.id)
        } catch {
          // ignora: relança o original abaixo
        }
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
      const obsoletos = [...alvo.videos]
        .filter(([id, existente]) => existente === titulo && id !== videoId)
        .map(([id]) => id)
      return { videoId, obsoletos }
    },

    async deleteVideo(videoId) {
      for (const colecao of colecoes.values()) {
        const titulo = colecao.videos.get(videoId)
        if (titulo === undefined) continue
        colecao.videos.delete(videoId)
        ops.push(`delete-video:${titulo}`)
      }
    },

    embedUrl: (videoId) => embedUrlFor(libraryId, videoId),
  }
}
