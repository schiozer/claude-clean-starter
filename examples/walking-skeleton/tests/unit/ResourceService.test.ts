import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ResourceService } from '@/modules/resources'
import { InMemoryResourceRepository } from '@/modules/resources/infrastructure/InMemoryResourceRepository'
import { ForbiddenError, DomainError } from '@/shared/errors'
import { makeActor } from '../helpers/makeActor'
import { fixedClock } from '../helpers/fixedClock'

describe('ResourceService', () => {
  let repo: InMemoryResourceRepository
  let service: ResourceService
  const write = ['resources:write']
  const read = ['resources:read']

  beforeEach(() => {
    repo = new InMemoryResourceRepository()
    service = new ResourceService(repo, fixedClock)
  })

  it('cria o recurso com owner e tenant derivados do actor', async () => {
    const dto = await service.create(makeActor({ scopes: write }), { title: 'Novo' })
    expect(dto).toMatchObject({ title: 'Novo', ownerId: 'user-1' })
    const [saved] = await repo.findByOwner('tenant-1', 'user-1', { limit: 1 })
    expect(saved.tenantId).toBe('tenant-1')
  })

  it('sem escopo de escrita → ForbiddenError e NÃO salva', async () => {
    const saveSpy = vi.spyOn(repo, 'save')
    await expect(service.create(makeActor({ scopes: read }), { title: 'Novo' })).rejects.toThrow(ForbiddenError)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('título inválido → DomainError e NÃO salva', async () => {
    const saveSpy = vi.spyOn(repo, 'save')
    await expect(service.create(makeActor({ scopes: write }), { title: 'ab' })).rejects.toThrow(DomainError)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('list sem escopo de leitura → ForbiddenError e NÃO consulta', async () => {
    const findSpy = vi.spyOn(repo, 'findByOwner')
    await expect(service.list(makeActor({ scopes: write }), { limit: 20 })).rejects.toThrow(ForbiddenError)
    expect(findSpy).not.toHaveBeenCalled()
  })

  it('list devolve só os recursos do próprio actor', async () => {
    await service.create(makeActor({ id: 'ana', scopes: write }), { title: 'Da Ana' })
    await service.create(makeActor({ id: 'bia', scopes: write }), { title: 'Da Bia' })
    const result = await service.list(makeActor({ id: 'ana', scopes: read }), { limit: 20 })
    expect(result.map((r) => r.title)).toEqual(['Da Ana'])
  })

  it('list isola por tenant (mesmo id de usuário em outro tenant)', async () => {
    await service.create(makeActor({ id: 'ana', tenantId: 't2', scopes: write }), { title: 'Outro tenant' })
    expect(await service.list(makeActor({ id: 'ana', scopes: read }), { limit: 20 })).toEqual([])
  })

  it('o DTO não vaza campos internos (ex.: tenantId)', async () => {
    const dto = await service.create(makeActor({ scopes: write }), { title: 'Novo' })
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'id', 'ownerId', 'title'])
  })
})
