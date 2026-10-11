import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'

describe('InMemoryResourceRepository', () => {
  let repo: InMemoryResourceRepository

  beforeEach(() => {
    repo = new InMemoryResourceRepository()
    repo.seed([
      { ownerId: 'ana', tenantId: 't1', title: 'A1' },
      { ownerId: 'bia', tenantId: 't1', title: 'B1' },
      { ownerId: 'ana', tenantId: 't1', title: 'A2' },
      { ownerId: 'ana', tenantId: 't2', title: 'Outro tenant' },
      { ownerId: 'ana', tenantId: 't1', title: 'A3' },
    ])
  })

  const titles = (rs: { title: { value: string } }[]) => rs.map((r) => r.title.value)

  it('filtra por tenant E owner', async () => {
    expect(titles(await repo.findByOwner('t1', 'ana', { limit: 50 }))).toEqual(['A1', 'A2', 'A3'])
  })

  it('respeita limit e continua do cursor', async () => {
    const first = await repo.findByOwner('t1', 'ana', { limit: 2 })
    expect(titles(first)).toEqual(['A1', 'A2'])
    const next = await repo.findByOwner('t1', 'ana', { limit: 2, cursor: first[1].id.value })
    expect(titles(next)).toEqual(['A3'])
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
