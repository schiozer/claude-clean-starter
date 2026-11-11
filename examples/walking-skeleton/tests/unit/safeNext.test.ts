import { describe, it, expect } from 'vitest'
import { safeNext } from '@/shared/http/safeNext'

/** Como o `?next=` chega à rota: decodificado pelo `URLSearchParams`. */
const decodificado = (bruto: string) => new URLSearchParams(`next=${bruto}`).get('next')

describe('safeNext (sem open redirect)', () => {
  it.each(['/%09/evil.com', '/%0a/evil.com', '/%5Cevil.com', '//evil.com', 'https://evil.com'])(
    'next=%s → /',
    (bruto) => {
      const destino = safeNext(decodificado(bruto))
      expect(destino).toBe('/')
      expect(new URL(destino, 'http://localhost:3100').origin).toBe('http://localhost:3100')
    }
  )

  it('ausente, vazio ou relativo sem / → /', () => {
    expect(safeNext(null)).toBe('/')
    expect(safeNext('')).toBe('/')
    expect(safeNext('evil.com')).toBe('/')
  })

  it('caminho legítimo com query e hash é preservado', () => {
    expect(safeNext(decodificado('%2Fresources%3Fa%3D1%26b%3D2'))).toBe('/resources?a=1&b=2')
    expect(safeNext('/resources?a=1#topo')).toBe('/resources?a=1#topo')
  })
})
