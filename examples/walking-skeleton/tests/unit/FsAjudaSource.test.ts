import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FsAjudaSource } from '@/modules/ajuda/infrastructure/FsAjudaSource'

const doc = (id: string, perfil = 'usuário final') => ({
  id,
  titulo: `Título de ${id}`,
  perfil,
  passos: [{ texto: 'Dado que estou logado', imagem: '01.png' }],
})

describe('FsAjudaSource', () => {
  let dir: string
  const escrever = (path: string, conteudo: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), conteudo)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ajuda-src-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('sem a pasta → lista vazia e get/imagem null', async () => {
    const source = new FsAjudaSource(join(dir, 'nao-existe'))
    expect(await source.list()).toEqual([])
    expect(await source.get('CT-RES-001')).toBeNull()
    expect(await source.imagem('CT-RES-001', 1)).toBeNull()
  })

  it('lista os JSON por contexto e ID, em ordem', async () => {
    escrever('RES/CT-RES-006.json', JSON.stringify(doc('CT-RES-006', 'time interno')))
    escrever('RES/CT-RES-001.json', JSON.stringify(doc('CT-RES-001')))
    escrever('AJU/CT-AJU-001.json', JSON.stringify(doc('CT-AJU-001')))
    escrever('RES/CT-RES-001/01.png', 'png')
    const lista = await new FsAjudaSource(dir).list()
    expect(lista.map((d) => d.id)).toEqual(['CT-AJU-001', 'CT-RES-001', 'CT-RES-006'])
  })

  it('JSON inválido sai da lista (vai para o log), sem derrubar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    escrever('RES/CT-RES-001.json', '{ quebrado')
    escrever('RES/CT-RES-002.json', JSON.stringify({ ...doc('CT-RES-002'), perfil: 'admin' }))
    escrever('RES/CT-RES-003.json', JSON.stringify(doc('CT-RES-003')))
    expect((await new FsAjudaSource(dir).list()).map((d) => d.id)).toEqual(['CT-RES-003'])
  })

  it('get com ID fora do padrão (caminho) → null', async () => {
    escrever('RES/CT-RES-001.json', JSON.stringify(doc('CT-RES-001')))
    expect(await new FsAjudaSource(dir).get('../RES/CT-RES-001')).toBeNull()
  })

  it('imagem com id de traversal → null, mesmo existindo o arquivo fora da pasta', async () => {
    escrever('x/01.png', 'png')
    escrever('RES/CT-RES-001/01.png', 'png')
    const source = new FsAjudaSource(join(dir, 'RES'))
    expect(await source.imagem('../x', 1)).toBeNull()
    expect(await source.imagem('../RES/CT-RES-001', 1)).toBeNull()
  })

  it('JSON cujo id não bate com o arquivo → null', async () => {
    escrever('RES/CT-RES-001.json', JSON.stringify(doc('CT-RES-002')))
    expect(await new FsAjudaSource(dir).get('CT-RES-001')).toBeNull()
  })

  it('imagem do passo n lê <CTX>/<ID>/NN.png', async () => {
    escrever('RES/CT-RES-001/02.png', 'png')
    const source = new FsAjudaSource(dir)
    expect(Buffer.from((await source.imagem('CT-RES-001', 2))!).toString()).toBe('png')
    expect(await source.imagem('CT-RES-001', 1)).toBeNull()
  })
})
