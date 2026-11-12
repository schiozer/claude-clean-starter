import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BunnyEmbeds } from '@/modules/ajuda/infrastructure/BunnyEmbeds'

const clock = { now: () => new Date(1_700_000_000_000) }

describe('BunnyEmbeds', () => {
  it('público → URL do iframe sem token', () => {
    const e = new BunnyEmbeds({ libraryId: 'lib', clock })
    expect(e.url('vid', { assinado: false })).toBe('https://iframe.mediadelivery.net/embed/lib/vid')
  })

  it('assinado com tokenKey → token sha256(key + id + expires) e validade de 3600 s', () => {
    const e = new BunnyEmbeds({ libraryId: 'lib', tokenKey: 'k', clock })
    const token = createHash('sha256')
      .update('k' + 'vid' + '1700003600')
      .digest('hex')
    expect(e.url('vid', { assinado: true })).toBe(
      `https://iframe.mediadelivery.net/embed/lib/vid?token=${token}&expires=1700003600`
    )
  })

  it('assinado sem tokenKey → null (fail-closed)', () => {
    const e = new BunnyEmbeds({ libraryId: 'lib', clock })
    expect(e.url('vid', { assinado: true })).toBeNull()
    expect(
      new BunnyEmbeds({ libraryId: 'lib', tokenKey: '', clock }).url('vid', { assinado: true })
    ).toBeNull()
  })
})
