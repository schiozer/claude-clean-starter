import { describe, expect, it } from 'vitest'
import { catalogoIndiceSchema } from '@/modules/ajuda'

const indice = (libraryId: string, videoId: string) => ({
  formato: 1,
  atualizadoEm: '2026-11-12T00:00:00.000Z',
  libraryId,
  versoes: ['v1.0.0'],
  demos: {
    'CT-RES-001': {
      id: 'CT-RES-001',
      titulo: 'T',
      contexto: 'RES',
      perfil: 'usuário final',
      videos: { desktop: videoId },
      versao: 'v1.0.0',
    },
  },
  treinamento: null,
})

describe('catalogoIndiceSchema', () => {
  it('aceita libraryId numérico e videoId uuid', () => {
    expect(
      catalogoIndiceSchema.safeParse(indice('123456', '0b6f1c2e-3d4a-4b5c-9d8e-7f6a5b4c3d2e'))
        .success
    ).toBe(true)
  })

  it('recusa libraryId com algo além de dígitos', () => {
    expect(catalogoIndiceSchema.safeParse(indice('123/../x', 'abc-1')).success).toBe(false)
    expect(catalogoIndiceSchema.safeParse(indice('', 'abc-1')).success).toBe(false)
  })

  it('recusa videoId com caracteres fora de [A-Za-z0-9-]', () => {
    expect(catalogoIndiceSchema.safeParse(indice('123', 'a/../b')).success).toBe(false)
    expect(catalogoIndiceSchema.safeParse(indice('123', 'a?x=1')).success).toBe(false)
  })
})
