import { describe, it, expect } from 'vitest'
import { makeFakeStorage, CAMINHO_INDICE } from '../../scripts/demos/catalogo.mjs'
import { makeFakeVideoHost } from '../../scripts/demos/video-host.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  avisoDeFalha,
  comSecaoDeDemos,
  lerManifesto,
  notasDasDemos,
  publicarDemos,
} from '../../scripts/demos/publicar.mjs'

const agora = new Date('2026-11-12T10:00:00.000Z')
const item = (id: string) => ({
  id,
  titulo: `T ${id}`,
  contexto: 'RES',
  perfil: 'usuário final' as const,
})
const selecao = {
  versao: 'v1.2.0',
  spec: 'specs/a.md',
  demos: [item('CT-RES-002')],
  treinamento: [item('CT-RES-001')],
}
const manifesto = {
  videos: [
    { id: 'CT-RES-002', projeto: 'desktop', arquivo: '/d2', ok: true },
    { id: 'CT-RES-002', projeto: 'mobile', arquivo: '/m2', ok: true },
    { id: 'CT-RES-001', projeto: 'desktop', arquivo: '/d1', ok: true },
  ],
}
const indiceAntigo = JSON.stringify({
  formato: 1,
  atualizadoEm: 'x',
  libraryId: 'lib-fake',
  versoes: ['v1.1.0'],
  demos: { 'CT-OLD-001': { ...item('CT-OLD-001'), videos: {}, versao: 'v1.1.0' } },
  treinamento: null,
})

const semear = () => {
  const host = makeFakeVideoHost()
  const storage = makeFakeStorage()
  storage.arquivos.set(CAMINHO_INDICE, indiceAntigo)
  return { host, storage }
}
const preparar = async () => {
  const s = semear()
  await s.host.replaceCollection('Treinamento', async () => undefined)
  s.host.ops.length = 0
  s.storage.ops.length = 0
  return s
}
const idx = (ops: string[], op: string) => {
  const i = ops.findIndex((o) => o.startsWith(op))
  expect(i, op).toBeGreaterThanOrEqual(0)
  return i
}

describe('publicarDemos', () => {
  it('respeita a ordem e mantém demos do índice antigo', async () => {
    const { host, storage } = await preparar()
    const { indice } = await publicarDemos({
      selecao,
      manifesto,
      host,
      storage,
      libraryId: 'lib-fake',
      agora,
    })
    const h = host.ops
    const s = storage.ops
    expect(idx(h, 'ensure:v1.2.0')).toBeLessThan(idx(h, 'upload:v1.2.0:'))
    expect(idx(h, 'upload:v1.2.0:')).toBeLessThan(idx(h, 'create:Treinamento'))
    expect(idx(h, 'create:Treinamento')).toBeLessThan(idx(h, 'upload:Treinamento:'))
    expect(idx(h, 'delete-collection:Treinamento')).toBeGreaterThan(idx(h, 'upload:Treinamento:'))
    expect(idx(s, 'gravar:catalogo/v1.2.0.json')).toBeLessThan(idx(s, 'gravar:catalogo/index.json'))
    expect(s.at(-1)).toBe('gravar:catalogo/index.json')
    expect(indice.versoes[0]).toBe('v1.2.0')
    expect(Object.keys(indice.demos)).toEqual(expect.arrayContaining(['CT-OLD-001', 'CT-RES-002']))
  })

  it('é idempotente ao rodar 2x', async () => {
    const { host, storage } = await preparar()
    const args = { selecao, manifesto, host, storage, libraryId: 'lib-fake', agora }
    await publicarDemos(args)
    await publicarDemos(args)
    const colecoes = [...host.colecoes.values()]
    expect(
      colecoes.filter((c) => c.nome === 'v1.2.0').flatMap((c) => [...c.videos.values()])
    ).toHaveLength(2)
    expect(colecoes.filter((c) => c.nome === 'Treinamento')).toHaveLength(1)
  })

  it('falha antes de qualquer upload se faltar vídeo ok', async () => {
    const { host, storage } = semear()
    const ruim = { videos: manifesto.videos.filter((v) => v.id !== 'CT-RES-001') }
    await expect(
      publicarDemos({ selecao, manifesto: ruim, host, storage, libraryId: 'l', agora })
    ).rejects.toThrow('demos: sem vídeo gravado para CT-RES-001')
    expect(host.ops).toEqual([])
    expect(storage.ops).toEqual([])
  })

  it('rerun de tag antiga não regride treinamento nem demos da versão mais nova', async () => {
    const host = makeFakeVideoHost()
    const storage = makeFakeStorage()
    const nova = { ...selecao, versao: 'v1.3.0' }
    const base = { manifesto, host, storage, libraryId: 'lib-fake', agora }
    const { indice: depoisDaNova } = await publicarDemos({ ...base, selecao: nova })
    const treinamentoNovo = [...host.colecoes.values()].find((c) => c.nome === 'Treinamento')!
    host.ops.length = 0

    const { indice, catalogo } = await publicarDemos({ ...base, selecao })

    expect(host.ops.some((op) => op.includes('Treinamento'))).toBe(false)
    expect([...host.colecoes.values()].filter((c) => c.nome === 'Treinamento')).toEqual([
      treinamentoNovo,
    ])
    expect(indice.treinamento).toEqual(depoisDaNova.treinamento)
    expect(indice.treinamento!.versao).toBe('v1.3.0')
    expect(indice.demos['CT-RES-002'].versao).toBe('v1.3.0')
    expect(indice.versoes).toEqual(['v1.3.0', 'v1.2.0'])
    expect(catalogo.versao).toBe('v1.2.0')
    expect(storage.arquivos.has('catalogo/v1.2.0.json')).toBe(true)
    expect(storage.ops.at(-1)).toBe('gravar:catalogo/index.json')
  })

  it('índice existente mas inválido → falha antes de qualquer upload', async () => {
    const host = makeFakeVideoHost()
    const storage = makeFakeStorage()
    storage.arquivos.set(CAMINHO_INDICE, '{ quebrado')
    await expect(
      publicarDemos({ selecao, manifesto, host, storage, libraryId: 'l', agora })
    ).rejects.toThrow('demos: catalogo/index.json inválido — corrija ou apague antes de publicar')
    expect(host.ops).toEqual([])
    expect(storage.ops.filter((op) => op.startsWith('gravar:'))).toEqual([])
  })

  it('apaga os vídeos obsoletos de mesmo título só depois de gravar o índice', async () => {
    const { host, storage } = await preparar()
    const args = { selecao, manifesto, host, storage, libraryId: 'lib-fake', agora }
    await publicarDemos(args)
    const log: string[] = []
    const hostLog = {
      ...host,
      deleteVideo: async (id: string) => {
        log.push(`delete-video:${id}`)
        return host.deleteVideo(id)
      },
    }
    const storageLog = {
      ...storage,
      gravar: async (caminho: string, conteudo: string) => {
        log.push(`gravar:${caminho}`)
        return storage.gravar(caminho, conteudo)
      },
    }
    await publicarDemos({ ...args, host: hostLog, storage: storageLog })
    const deletes = log.filter((op) => op.startsWith('delete-video:'))
    expect(deletes).toHaveLength(2)
    expect(log.indexOf('gravar:catalogo/index.json')).toBeLessThan(log.indexOf(deletes[0]!))
  })

  it('falha ao gravar o índice preserva Treinamento e index.json antigos', async () => {
    const { host, storage } = await preparar()
    const antigaId = [...host.colecoes].find(([, c]) => c.nome === 'Treinamento')![0]
    const quebrado = {
      ...storage,
      gravar: async (caminho: string, conteudo: string) => {
        if (caminho === CAMINHO_INDICE) throw new Error('boom')
        return storage.gravar(caminho, conteudo)
      },
    }
    await expect(
      publicarDemos({ selecao, manifesto, host, storage: quebrado, libraryId: 'l', agora })
    ).rejects.toThrow('boom')
    const treinamentos = [...host.colecoes].filter(([, c]) => c.nome === 'Treinamento')
    expect(treinamentos.map(([id]) => id)).toEqual([antigaId])
    expect(
      [...host.colecoes.keys()].filter((id) => host.colecoes.get(id)!.nome === 'Treinamento')
    ).toHaveLength(1)
    expect(storage.arquivos.get(CAMINHO_INDICE)).toBe(indiceAntigo)
  })
})

describe('lerManifesto', () => {
  it('manifesto ausente → erro que aponta o modo demos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demos-'))
    try {
      expect(() => lerManifesto(join(dir, 'manifesto.json'))).toThrow(
        'demos: manifesto ausente — rode demos:gravar com o modo demos (modoDemos) no playwright.config.ts'
      )
      writeFileSync(join(dir, 'manifesto.json'), '{"videos":[]}')
      expect(lerManifesto(join(dir, 'manifesto.json'))).toEqual({ videos: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('textos da Release', () => {
  it('notasDasDemos lista só demos de usuário final (nunca link de time interno)', () => {
    const host = makeFakeVideoHost({ libraryId: '9' })
    const catalogo = {
      demos: [
        { ...item('A'), videos: { desktop: 'd' } },
        { ...item('B'), perfil: 'time interno', videos: { desktop: 'segredo' } },
      ],
    } as never
    const notas = notasDasDemos(catalogo, host)
    expect(notas).toContain('[A — T A]')
    expect(notas).not.toContain('segredo')
    expect(notas).not.toContain('B — T B')
    const soInterno = {
      demos: [{ ...item('B'), perfil: 'time interno', videos: { desktop: 'x' } }],
    } as never
    expect(notasDasDemos(soInterno, host)).toContain('Nenhuma demo nesta versão.')
  })

  it('notasDasDemos lista demos com embed do desktop, senão mobile', () => {
    const host = makeFakeVideoHost({ libraryId: '9' })
    const catalogo = {
      demos: [
        { ...item('A'), videos: { desktop: 'd', mobile: 'm' } },
        { ...item('B'), videos: { mobile: 'm2' } },
      ],
    } as never
    expect(notasDasDemos(catalogo, host)).toBe(
      '<!-- demos -->\n### Demos\n' +
        '- [A — T A](https://iframe.mediadelivery.net/embed/9/d)\n' +
        '- [B — T B](https://iframe.mediadelivery.net/embed/9/m2)'
    )
    expect(notasDasDemos({ demos: [] } as never, host)).toContain('Nenhuma demo nesta versão.')
  })

  it('avisoDeFalha cita o run', () => {
    expect(avisoDeFalha('http://r')).toBe(
      '<!-- demos -->\n### Demos\n⚠️ A publicação das demos falhou ([run](http://r)). Rode de novo em Actions → Demos & Treinamento → Run workflow, com a tag.'
    )
  })

  it('comSecaoDeDemos substitui ou acrescenta', () => {
    expect(comSecaoDeDemos('corpo\n<!-- demos -->\nvelho', 'S')).toBe('corpo\nS')
    expect(comSecaoDeDemos('corpo', 'S')).toBe('corpo\n\nS')
  })
})
