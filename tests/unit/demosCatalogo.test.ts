import { describe, it, expect, vi } from 'vitest'
import {
  CAMINHO_INDICE,
  caminhoDaVersao,
  lerIndice,
  makeBunnyStorage,
  makeFakeStorage,
  montarIndice,
} from '../../scripts/demos/catalogo.mjs'

const agora = new Date('2026-11-12T10:00:00.000Z')

const item = (id: string, perfil = 'usuário final', titulo = id) => ({
  id,
  titulo,
  contexto: 'resources',
  perfil,
  videos: { desktop: `vid-${id}` },
})

const versao = (v: string, demos: ReturnType<typeof item>[]) => ({
  formato: 1 as const,
  versao: v,
  geradoEm: agora.toISOString(),
  libraryId: 'lib',
  spec: null,
  demos,
})

const indiceAnterior = (versoes: string[], demos = {}) => ({
  formato: 1 as const,
  atualizadoEm: '2026-01-01T00:00:00.000Z',
  libraryId: 'lib',
  versoes,
  demos,
  treinamento: null,
})

describe('montarIndice', () => {
  it('mescla as demos do anterior com as da versão, que sobrescrevem por id', () => {
    const anterior = indiceAnterior(['v1.1.0'], {
      'CT-RES-001': { ...item('CT-RES-001'), versao: 'v1.1.0' },
    })
    const indice = montarIndice({
      anterior,
      versao: versao('v1.2.0', [item('CT-RES-001'), item('CT-RES-006')]),
      treinamento: [],
      agora,
    })
    expect(indice.versoes).toEqual(['v1.2.0', 'v1.1.0'])
    expect(indice.demos['CT-RES-001'].versao).toBe('v1.2.0')
    expect(Object.keys(indice.demos).sort()).toEqual(['CT-RES-001', 'CT-RES-006'])
    expect(indice.atualizadoEm).toBe(agora.toISOString())
    expect(indice.treinamento).toEqual({ versao: 'v1.2.0', trilhas: [] })
  })

  it('ordena versões por SemVer, não lexicalmente, e sem repetição', () => {
    const indice = montarIndice({
      anterior: indiceAnterior(['v1.10.0', 'v1.9.0']),
      versao: versao('v1.2.0', []),
      treinamento: [],
      agora,
    })
    expect(indice.versoes).toEqual(['v1.10.0', 'v1.9.0', 'v1.2.0'])
    const repetido = montarIndice({
      anterior: indice,
      versao: versao('v1.9.0', []),
      treinamento: [],
      agora,
    })
    expect(repetido.versoes).toEqual(['v1.10.0', 'v1.9.0', 'v1.2.0'])
  })

  it('agrupa o treinamento por perfil, usuário final primeiro, itens por id', () => {
    const indice = montarIndice({
      anterior: null,
      versao: versao('v1.2.0', []),
      treinamento: [item('CT-RES-006', 'time interno'), item('CT-RES-003'), item('CT-RES-001')],
      agora,
    })
    const trilhas = indice.treinamento!.trilhas
    expect(trilhas.map((t) => t.perfil)).toEqual(['usuário final', 'time interno'])
    expect(trilhas[0].itens.map((i) => i.id)).toEqual(['CT-RES-001', 'CT-RES-003'])
  })
})

describe('lerIndice', () => {
  it('devolve null para ausente, JSON inválido ou formato desconhecido', () => {
    expect(lerIndice(null)).toBeNull()
    expect(lerIndice('{')).toBeNull()
    expect(lerIndice('{"formato":2}')).toBeNull()
  })

  it('devolve o índice válido', () => {
    const indice = indiceAnterior(['v1.0.0'])
    expect(lerIndice(JSON.stringify(indice))).toEqual(indice)
  })
})

describe('caminhos', () => {
  it('expõe os caminhos do catálogo', () => {
    expect(CAMINHO_INDICE).toBe('catalogo/index.json')
    expect(caminhoDaVersao('v1.2.0')).toBe('catalogo/v1.2.0.json')
  })
})

describe('makeFakeStorage', () => {
  it('registra ler/gravar em ops', async () => {
    const storage = makeFakeStorage()
    expect(await storage.ler('a.json')).toBeNull()
    await storage.gravar('a.json', '{}')
    expect(await storage.ler('a.json')).toBe('{}')
    expect(storage.ops).toEqual(['ler:a.json', 'gravar:a.json', 'ler:a.json'])
  })
})

describe('makeBunnyStorage', () => {
  const senha = 'segredo-super-secreto'

  it('grava via PUT com AccessKey e content-type json', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 201 }))
    const storage = makeBunnyStorage({ zona: 'zona', senha, fetchFn })
    await storage.gravar('catalogo/index.json', '{}')
    expect(fetchFn).toHaveBeenCalledWith(
      'https://storage.bunnycdn.com/zona/catalogo/index.json',
      expect.objectContaining({
        method: 'PUT',
        body: '{}',
        headers: expect.objectContaining({
          AccessKey: senha,
          'content-type': 'application/json',
        }),
      })
    )
  })

  it('ler com 404 devolve null e com 200 devolve o texto', async () => {
    const naoExiste = makeBunnyStorage({
      zona: 'zona',
      senha,
      fetchFn: async () => new Response('', { status: 404 }),
    })
    expect(await naoExiste.ler('catalogo/index.json')).toBeNull()
    const existe = makeBunnyStorage({
      zona: 'zona',
      senha,
      fetchFn: async () => new Response('{"a":1}', { status: 200 }),
    })
    expect(await existe.ler('catalogo/index.json')).toBe('{"a":1}')
  })

  it('erro HTTP não vaza a senha', async () => {
    const storage = makeBunnyStorage({
      zona: 'zona',
      senha,
      fetchFn: async () => new Response('', { status: 500 }),
    })
    const erro = await storage.ler('catalogo/index.json').catch((e: Error) => e)
    expect((erro as Error).message).toMatch(/^bunny-storage: GET catalogo\/index.json → 500$/)
    expect((erro as Error).message).not.toContain(senha)
  })
})
