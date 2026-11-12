import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BunnyEmbeds } from '@/modules/ajuda/infrastructure/BunnyEmbeds'

const clock = { now: () => new Date(1_700_000_000_000) }
const tokenDe = (videoId: string) =>
  createHash('sha256')
    .update('k' + videoId + '1700003600')
    .digest('hex')

describe('BunnyEmbeds', () => {
  it('sem tokenKey, público → URL do iframe sem token', () => {
    const e = new BunnyEmbeds({ libraryId: '123', clock })
    expect(e.url('vid', { assinado: false })).toBe('https://iframe.mediadelivery.net/embed/123/vid')
  })

  it('com tokenKey, assinado → token sha256(key + id + expires) e validade de 3600 s', () => {
    const e = new BunnyEmbeds({ libraryId: '123', tokenKey: 'k', clock })
    expect(e.url('vid', { assinado: true })).toBe(
      `https://iframe.mediadelivery.net/embed/123/vid?token=${tokenDe('vid')}&expires=1700003600`
    )
  })

  it('com tokenKey, público também sai assinado (token auth vale para a library inteira)', () => {
    const e = new BunnyEmbeds({ libraryId: '123', tokenKey: 'k', clock })
    expect(e.url('vid', { assinado: false })).toBe(
      `https://iframe.mediadelivery.net/embed/123/vid?token=${tokenDe('vid')}&expires=1700003600`
    )
  })

  it('assinado sem tokenKey → null (fail-closed)', () => {
    const e = new BunnyEmbeds({ libraryId: '123', clock })
    expect(e.url('vid', { assinado: true })).toBeNull()
    expect(
      new BunnyEmbeds({ libraryId: '123', tokenKey: '', clock }).url('vid', { assinado: true })
    ).toBeNull()
  })
})
