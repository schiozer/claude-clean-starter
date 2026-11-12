import { createHash } from 'node:crypto'
import type { IEmbeds } from '../application/IVideosDaAjuda'
import type { Clock } from '@/shared/kernel'

const VALIDADE_S = 3600

/**
 * Embed do Bunny Stream. O token auth do Bunny vale para a library inteira: com `tokenKey` (env
 * `BUNNY_STREAM_TOKEN_KEY`) **todo** embed sai assinado. Sem ela, o que exige assinatura (time
 * interno) devolve `null` (fail-closed, nunca uma URL pública no lugar) e o resto sai público.
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
    if (!this.tokenKey) return assinado ? null : base
    const expires = Math.floor(this.clock.now().getTime() / 1000) + VALIDADE_S
    const token = createHash('sha256')
      .update(this.tokenKey + videoId + String(expires))
      .digest('hex')
    return `${base}?token=${token}&expires=${expires}`
  }
}
