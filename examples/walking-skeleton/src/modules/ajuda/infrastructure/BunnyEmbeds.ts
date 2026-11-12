import { createHash } from 'node:crypto'
import type { IEmbeds } from '../application/IVideosDaAjuda'
import type { Clock } from '@/shared/kernel'

const VALIDADE_S = 3600

/**
 * Embed do Bunny Stream. Assinado exige `tokenKey` (env `BUNNY_STREAM_TOKEN_KEY`); sem ela
 * devolve `null` (fail-closed), nunca uma URL pública no lugar.
 */
export class BunnyEmbeds implements IEmbeds {
  private readonly libraryId: string
  private readonly tokenKey: string | undefined
  private readonly clock: Clock

  constructor(opts: { libraryId: string; tokenKey?: string; clock: Clock }) {
    this.libraryId = opts.libraryId
    this.tokenKey = opts.tokenKey
    this.clock = opts.clock
  }

  url(videoId: string, { assinado }: { assinado: boolean }): string | null {
    const base = `https://iframe.mediadelivery.net/embed/${this.libraryId}/${videoId}`
    if (!assinado) return base
    if (!this.tokenKey) return null
    const expires = Math.floor(this.clock.now().getTime() / 1000) + VALIDADE_S
    const token = createHash('sha256')
      .update(this.tokenKey + videoId + String(expires))
      .digest('hex')
    return `${base}?token=${token}&expires=${expires}`
  }
}
