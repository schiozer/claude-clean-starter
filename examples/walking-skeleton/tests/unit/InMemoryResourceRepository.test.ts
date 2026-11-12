import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'

describe('InMemoryResourceRepository', () => {
  let repo: InMemoryResourceRepository

  beforeEach(() => {
    repo = new InMemoryResourceRepository()
    repo.seed([
      { ownerId: 'ana', tenantId: 't1', title: 'Ana 1' },
      { ownerId: 'bia', tenantId: 't1', title: 'Bia 1' },
      { ownerId: 'ana', tenantId: 't1', title: 'Ana 2' },
      { ownerId: 'ana', tenantId: 't2', title: 'Outro tenant' },
      { ownerId: 'ana', tenantId: 't1', title: 'Ana 3' },
    ])
  })

  const titles = (rs: { title: { value: string } }[]) => rs.map((r) => r.title.value)

  it('filtra por tenant E owner, do mais novo ao mais antigo', async () => {
    expect(titles(await repo.findByOwner('t1', 'ana', { limit: 50 }))).toEqual(['Ana 3', 'Ana 2', 'Ana 1'])
  })

  it('respeita limit e continua do cursor', async () => {
    const first = await repo.findByOwner('t1', 'ana', { limit: 2 })
    expect(titles(first)).toEqual(['Ana 3', 'Ana 2'])
    const next = await repo.findByOwner('t1', 'ana', { limit: 2, cursor: first[1].id.value })
    expect(titles(next)).toEqual(['Ana 1'])
  })

  it('paginação por cursor percorre tudo sem perder nem repetir, com item novo no meio', async () => {
    const vistos: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 10; i++) {
      const page = await repo.findByOwner('t1', 'ana', { limit: 1, cursor })
      if (page.length === 0) break
      vistos.push(...titles(page))
      cursor = page[page.length - 1].id.value
      // Criado durante a paginação: entra no topo, não desloca as páginas seguintes.
      if (i === 0) repo.seed([{ ownerId: 'ana', tenantId: 't1', title: 'Ana 4' }])
    }
    expect(vistos).toEqual(['Ana 3', 'Ana 2', 'Ana 1'])
    expect(titles(await repo.findByOwner('t1', 'ana', { limit: 1 }))).toEqual(['Ana 4'])
  })

  it('cursor desconhecido → página vazia (não reinicia)', async () => {
    expect(await repo.findByOwner('t1', 'ana', { limit: 2, cursor: 'nao-existe' })).toEqual([])
  })

  it('cursor de outro owner → página vazia (não vaza)', async () => {
    const [bia] = await repo.findByOwner('t1', 'bia', { limit: 1 })
    expect(await repo.findByOwner('t1', 'ana', { limit: 2, cursor: bia.id.value })).toEqual([])
  })

  it('clear esvazia o repositório', async () => {
    repo.clear()
    expect(await repo.findByOwner('t1', 'ana', { limit: 50 })).toEqual([])
  })
})
