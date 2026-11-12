import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AjudaService,
  type AjudaDoc,
  type CatalogoIndice,
  type IAjudaSource,
  type IVideosDaAjuda,
} from '@/modules/ajuda'
import { BunnyEmbeds } from '@/modules/ajuda/infrastructure/BunnyEmbeds'
import { ForbiddenError, NotFoundError, ValidationError } from '@/shared/errors'
import { makeActor } from '../helpers/makeActor'

const doc = (id: string, perfil: AjudaDoc['perfil']): AjudaDoc => ({
  id,
  titulo: `Título de ${id}`,
  perfil,
  passos: [
    { texto: 'Dado que estou logado', imagem: '01.png' },
    { texto: 'Quando abro a lista', imagem: '02.png' },
  ],
})

const PUBLICO = doc('CT-RES-001', 'usuário final')
const INTERNO = doc('CT-RES-006', 'time interno')
const PNG = new Uint8Array([137, 80, 78, 71])

class FakeAjudaSource implements IAjudaSource {
  constructor(private readonly docs: AjudaDoc[]) {}
  async list(): Promise<AjudaDoc[]> {
    return this.docs
  }
  async get(id: string): Promise<AjudaDoc | null> {
    return this.docs.find((d) => d.id === id) ?? null
  }
  async imagem(id: string, n: number): Promise<Uint8Array | null> {
    const d = this.docs.find((x) => x.id === id)
    return d && n >= 1 && n <= d.passos.length ? PNG : null
  }
}

describe('AjudaService', () => {
  let source: FakeAjudaSource
  let service: AjudaService
  const usuario = makeActor({ scopes: ['ajuda:read'] })
  const interno = makeActor({ scopes: ['ajuda:read', 'ajuda:interno'] })
  const semEscopo = makeActor({ scopes: ['resources:read'] })

  beforeEach(() => {
    source = new FakeAjudaSource([PUBLICO, INTERNO])
    service = new AjudaService(source)
  })

  it('sem ajuda:read → ForbiddenError em list, get e imagem, sem ler a fonte', async () => {
    const list = vi.spyOn(source, 'list')
    const get = vi.spyOn(source, 'get')
    const imagem = vi.spyOn(source, 'imagem')
    await expect(service.list(semEscopo)).rejects.toThrow(ForbiddenError)
    await expect(service.get(semEscopo, { id: PUBLICO.id })).rejects.toThrow(ForbiddenError)
    await expect(service.imagem(semEscopo, { id: PUBLICO.id, n: 1 })).rejects.toThrow(
      ForbiddenError
    )
    expect(list).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(imagem).not.toHaveBeenCalled()
  })

  it('usuário final não vê o doc de time interno na lista', async () => {
    const lista = await service.list(usuario)
    expect(lista.map((d) => d.id)).toEqual([PUBLICO.id])
  })

  it('a lista traz o contexto (sigla do ID) e o total de passos', async () => {
    const [primeiro] = await service.list(usuario)
    expect(primeiro).toMatchObject({ id: 'CT-RES-001', contexto: 'RES', perfil: 'usuário final' })
    expect(primeiro?.passos).toHaveLength(2)
  })

  it('usuário final abre o doc público', async () => {
    expect(await service.get(usuario, { id: PUBLICO.id })).toMatchObject({ id: PUBLICO.id })
  })

  it('usuário final pedindo o doc interno → NotFoundError (não revela que existe)', async () => {
    await expect(service.get(usuario, { id: INTERNO.id })).rejects.toThrow(NotFoundError)
  })

  it('time interno vê os dois na lista e abre o interno', async () => {
    const lista = await service.list(interno)
    expect(lista.map((d) => d.id)).toEqual([PUBLICO.id, INTERNO.id])
    expect(await service.get(interno, { id: INTERNO.id })).toMatchObject({ id: INTERNO.id })
  })

  it('doc inexistente → NotFoundError', async () => {
    await expect(service.get(interno, { id: 'CT-RES-999' })).rejects.toThrow(NotFoundError)
    await expect(service.get(interno, { id: 'CT-RES-999' })).rejects.toThrow(
      'Página de ajuda não encontrada'
    )
  })

  it('id fora do padrão CT-<CTX>-NNN → ValidationError, sem ler a fonte', async () => {
    const get = vi.spyOn(source, 'get')
    await expect(service.get(usuario, { id: '../segredo' })).rejects.toThrow(ValidationError)
    expect(get).not.toHaveBeenCalled()
  })

  it('imagem do doc público para o usuário final', async () => {
    expect(await service.imagem(usuario, { id: PUBLICO.id, n: 1 })).toEqual(PNG)
  })

  it('imagem do doc interno sem ajuda:interno → NotFoundError, sem ler a imagem', async () => {
    const imagem = vi.spyOn(source, 'imagem')
    await expect(service.imagem(usuario, { id: INTERNO.id, n: 1 })).rejects.toThrow(NotFoundError)
    expect(imagem).not.toHaveBeenCalled()
  })

  it('imagem do doc interno para o time interno', async () => {
    expect(await service.imagem(interno, { id: INTERNO.id, n: 2 })).toEqual(PNG)
  })

  it('passo fora do doc → NotFoundError, sem ler a imagem', async () => {
    const imagem = vi.spyOn(source, 'imagem')
    await expect(service.imagem(usuario, { id: PUBLICO.id, n: 3 })).rejects.toThrow(NotFoundError)
    await expect(service.imagem(usuario, { id: PUBLICO.id, n: 3 })).rejects.toThrow(
      'Imagem não encontrada'
    )
    expect(imagem).not.toHaveBeenCalled()
  })

  it('passo não inteiro ou < 1 → ValidationError', async () => {
    await expect(service.imagem(usuario, { id: PUBLICO.id, n: 0 })).rejects.toThrow(ValidationError)
    await expect(service.imagem(usuario, { id: PUBLICO.id, n: 1.5 })).rejects.toThrow(
      ValidationError
    )
  })

  describe('vídeos', () => {
    const clock = { now: () => new Date(1_700_000_000_000) }
    const item = (
      id: string,
      perfil: AjudaDoc['perfil'],
      videos: { desktop?: string; mobile?: string }
    ) => ({
      id,
      titulo: `Título de ${id}`,
      contexto: 'RES',
      perfil,
      videos,
    })
    const indice = (): CatalogoIndice => ({
      formato: 1,
      atualizadoEm: '2026-11-12T00:00:00.000Z',
      libraryId: 'lib',
      versoes: ['v1.2.0'],
      demos: {
        'CT-RES-001': {
          ...item('CT-RES-001', 'usuário final', { mobile: 'm1' }),
          versao: 'v1.2.0',
        },
        'CT-RES-006': {
          ...item('CT-RES-006', 'time interno', { desktop: 'd6', mobile: 'm6' }),
          versao: 'v1.2.0',
        },
      },
      treinamento: {
        versao: 'v1.2.0',
        trilhas: [
          {
            perfil: 'usuário final',
            itens: [item('CT-RES-001', 'usuário final', { desktop: 'd1' })],
          },
          {
            perfil: 'time interno',
            itens: [
              item('CT-RES-006', 'time interno', { desktop: 'd6' }),
              item('CT-RES-007', 'time interno', {}),
            ],
          },
        ],
      },
    })
    const videosCom = (valor: CatalogoIndice | null): IVideosDaAjuda => ({
      indice: async () => valor,
    })
    const comVideos = (valor: CatalogoIndice | null, tokenKey?: string) =>
      new AjudaService(
        source,
        videosCom(valor),
        (libraryId) => new BunnyEmbeds({ libraryId, tokenKey, clock })
      )

    it('sem videos → desligado; list sempre desligado', async () => {
      expect((await service.get(usuario, { id: PUBLICO.id })).videos).toEqual({
        estado: 'desligado',
      })
      const lista = await comVideos(indice()).list(interno)
      expect(lista.every((d) => d.videos.estado === 'desligado')).toBe(true)
    })

    it('índice indisponível → indisponivel e o resto do DTO igual', async () => {
      const base = await service.get(usuario, { id: PUBLICO.id })
      const dto = await comVideos(null).get(usuario, { id: PUBLICO.id })
      expect(dto.videos).toEqual({ estado: 'indisponivel' })
      expect({ ...dto, videos: base.videos }).toEqual(base)
    })

    it('usuário final: demo pública (desktop senão mobile) e só a trilha dele', async () => {
      const dto = await comVideos(indice(), 'k').get(usuario, { id: PUBLICO.id })
      expect(dto.videos).toEqual({
        estado: 'ok',
        demo: {
          versao: 'v1.2.0',
          embedUrl: 'https://iframe.mediadelivery.net/embed/lib/m1',
          titulo: 'Título de CT-RES-001',
        },
        treinamento: [
          {
            id: 'CT-RES-001',
            titulo: 'Título de CT-RES-001',
            embedUrl: 'https://iframe.mediadelivery.net/embed/lib/d1',
          },
        ],
      })
    })

    it('time interno com tokenKey: demo e treinamento assinados, itens sem vídeo omitidos', async () => {
      const dto = await comVideos(indice(), 'k').get(interno, { id: INTERNO.id })
      if (dto.videos.estado !== 'ok') throw new Error('esperava ok')
      expect(dto.videos.demo?.embedUrl).toMatch(
        /\/embed\/lib\/d6\?token=[0-9a-f]{64}&expires=1700003600$/
      )
      expect(dto.videos.treinamento.map((t) => t.id)).toEqual(['CT-RES-001', 'CT-RES-006'])
      expect(dto.videos.treinamento[1]?.embedUrl).toContain('token=')
      expect(dto.videos.treinamento[0]?.embedUrl).not.toContain('token=')
    })

    it('time interno sem tokenKey → demo null e itens internos fora (fail-closed)', async () => {
      const dto = await comVideos(indice()).get(interno, { id: INTERNO.id })
      if (dto.videos.estado !== 'ok') throw new Error('esperava ok')
      expect(dto.videos.demo).toBeNull()
      expect(dto.videos.treinamento.map((t) => t.id)).toEqual(['CT-RES-001'])
    })

    it('ator sem ajuda:interno não recebe itens da trilha time interno', async () => {
      const dto = await comVideos(indice(), 'k').get(usuario, { id: PUBLICO.id })
      if (dto.videos.estado !== 'ok') throw new Error('esperava ok')
      expect(dto.videos.treinamento.map((t) => t.id)).toEqual(['CT-RES-001'])
    })

    it('cenário sem demo no índice → demo null', async () => {
      const i = indice()
      delete i.demos['CT-RES-001']
      const dto = await comVideos(i).get(usuario, { id: PUBLICO.id })
      if (dto.videos.estado !== 'ok') throw new Error('esperava ok')
      expect(dto.videos.demo).toBeNull()
    })
  })
})
