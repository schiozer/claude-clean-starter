import { logError } from '@/shared/logError'
import type { Clock } from '@/shared/kernel'
import { catalogoIndiceSchema, type CatalogoIndice } from '../application/catalogo'
import type { IVideosDaAjuda } from '../application/IVideosDaAjuda'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** Lê `catalogo/index.json` da CDN, com cache do último índice válido e prazo curto. */
export class CdnCatalogoDeVideos implements IVideosDaAjuda {
  private readonly url: string
  private readonly fetchFn: FetchFn
  private readonly clock: Clock
  private readonly ttlMs: number
  private readonly timeoutMs: number
  private cache: { indice: CatalogoIndice; lidoEm: number } | null = null

  constructor(opts: {
    url: string
    fetchFn?: FetchFn
    clock: Clock
    ttlMs?: number
    timeoutMs?: number
  }) {
    this.url = opts.url
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis)
    this.clock = opts.clock
    this.ttlMs = opts.ttlMs ?? 300_000
    this.timeoutMs = opts.timeoutMs ?? 3_000
  }

  /** `forcar` é uma costura de teste: ignora o cache válido e busca de novo. */
  async indice(opts: { forcar?: boolean } = {}): Promise<CatalogoIndice | null> {
    const agora = this.clock.now().getTime()
    const valido = this.cache && agora - this.cache.lidoEm < this.ttlMs ? this.cache : null
    if (valido && !opts.forcar) return valido.indice
    try {
      const indice = await this.buscar()
      this.cache = { indice, lidoEm: agora }
      return indice
    } catch (erro) {
      logError('ajuda:catalogo', erro)
      return valido?.indice ?? null
    }
  }

  private async buscar(): Promise<CatalogoIndice> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const prazo = new Promise<never>((_, rejeita) => {
      timer = setTimeout(() => {
        controller.abort()
        rejeita(new Error(`Catálogo de vídeos: prazo de ${this.timeoutMs} ms excedido`))
      }, this.timeoutMs)
    })
    try {
      return await Promise.race([this.ler(controller.signal), prazo])
    } finally {
      clearTimeout(timer)
    }
  }

  private async ler(signal: AbortSignal): Promise<CatalogoIndice> {
    const resposta = await this.fetchFn(this.url, { signal, cache: 'no-store' })
    if (!resposta.ok) throw new Error(`Catálogo de vídeos: status ${resposta.status}`)
    const parsed = catalogoIndiceSchema.safeParse(JSON.parse(await resposta.text()))
    if (!parsed.success) throw new Error('Catálogo de vídeos: índice inválido')
    return parsed.data
  }
}
