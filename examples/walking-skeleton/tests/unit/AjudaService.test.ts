import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AjudaService, type AjudaDoc, type IAjudaSource } from '@/modules/ajuda'
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
    expect(imagem).not.toHaveBeenCalled()
  })

  it('passo não inteiro ou < 1 → ValidationError', async () => {
    await expect(service.imagem(usuario, { id: PUBLICO.id, n: 0 })).rejects.toThrow(ValidationError)
    await expect(service.imagem(usuario, { id: PUBLICO.id, n: 1.5 })).rejects.toThrow(
      ValidationError
    )
  })
})
