import { describe, it, expect } from 'vitest'
import { safeNext } from '@/shared/http/safeNext'

/** Como o `?next=` chega à rota: decodificado pelo `URLSearchParams`. */
const decodificado = (bruto: string) => new URLSearchParams(`next=${bruto}`).get('next')

const ORIGEM = 'http://localhost:3100'

const ATAQUES = [
  '/%09/evil.com',
  '/%0a/evil.com',
  '/%5Cevil.com',
  '//evil.com',
  'https://evil.com',
  '/.//evil.com',
  '/a/../..//evil.com',
  '/..//evil.com',
  '/./\\evil.com',
]

const LEGITIMOS = ['%2Fresources%3Fa%3D1%26b%3D2', '/resources?a=1#topo', '/', '/a/../resources']

describe('safeNext (sem open redirect)', () => {
  it.each(ATAQUES)('next=%s → /', (bruto) => {
    expect(safeNext(decodificado(bruto))).toBe('/')
  })

  it.each([...ATAQUES, ...LEGITIMOS])('next=%s resolve sempre na origem do app', (bruto) => {
    expect(new URL(safeNext(decodificado(bruto)), ORIGEM).origin).toBe(ORIGEM)
  })

  it('ausente, vazio ou relativo sem / → /', () => {
    expect(safeNext(null)).toBe('/')
    expect(safeNext('')).toBe('/')
    expect(safeNext('evil.com')).toBe('/')
  })

  it('caminho legítimo com query e hash é preservado', () => {
    expect(safeNext(decodificado('%2Fresources%3Fa%3D1%26b%3D2'))).toBe('/resources?a=1&b=2')
    expect(safeNext('/resources?a=1#topo')).toBe('/resources?a=1#topo')
    expect(safeNext('/a/../resources')).toBe('/resources')
  })
})
