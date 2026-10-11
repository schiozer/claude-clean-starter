import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GET, POST } from '@/app/api/resources/route'
import { resourceRepository } from '@/composition'

const postReq = (body: unknown) =>
  new Request('http://localhost/api/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

afterEach(() => {
  delete process.env.RESOURCES_ENABLED
  delete process.env.APP_ENV
  vi.restoreAllMocks()
})

describe('rota /api/resources (flag on, Dev local)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'on'
    process.env.APP_ENV = 'development'
    resourceRepository.clear()
  })

  it('POST com título válido → 201 e owner = usuário da sessão', async () => {
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(201)
    expect((await res.json()).ownerId).toBe('dev-user')
  })

  it('POST com título inválido → 400 VALIDATION_ERROR', async () => {
    const res = await POST(postReq({ title: 'ab' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('VALIDATION_ERROR')
  })

  it('POST com JSON malformado → 400 VALIDATION_ERROR (não 500)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const req = new Request('http://localhost/api/resources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title":',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'JSON inválido', code: 'VALIDATION_ERROR' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('POST ignora ownerId do corpo (owner vem da sessão)', async () => {
    const res = await POST(postReq({ title: 'Válido', ownerId: 'bia' }))
    expect((await res.json()).ownerId).toBe('dev-user')
  })

  it('GET lista o que foi criado', async () => {
    await POST(postReq({ title: 'Válido' }))
    const res = await GET(new Request('http://localhost/api/resources'))
    const body = await res.json()
    expect(body.items.map((r: { title: string }) => r.title)).toEqual(['Válido'])
    expect(body.nextCursor).toBeNull()
  })

  it('GET respeita ?limit= e rejeita limit > 50', async () => {
    await POST(postReq({ title: 'Um1' }))
    await POST(postReq({ title: 'Dois' }))
    const first = await (await GET(new Request('http://localhost/api/resources?limit=1'))).json()
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBe(first.items[0].id)
    const url = `http://localhost/api/resources?limit=1&cursor=${first.nextCursor}`
    const second = await (await GET(new Request(url))).json()
    expect(second.items).toHaveLength(1)
    expect(second.items[0].id).not.toBe(first.items[0].id)
    const bad = await GET(new Request('http://localhost/api/resources?limit=51'))
    expect(bad.status).toBe(400)
  })
})

describe('rota /api/resources (fora do Dev)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'on'
    resourceRepository.clear()
  })

  it('sem sessão real → 401 UNAUTHORIZED e NÃO persiste', async () => {
    const saveSpy = vi.spyOn(resourceRepository, 'save')
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('UNAUTHORIZED')
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('rota /api/resources (flag off)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'off'
    process.env.APP_ENV = 'development'
    resourceRepository.clear()
  })

  it('POST → 404 quando desligado e NÃO persiste', async () => {
    const saveSpy = vi.spyOn(resourceRepository, 'save')
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(404)
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('GET → 404 quando desligado', async () => {
    expect((await GET(new Request('http://localhost/api/resources'))).status).toBe(404)
  })
})
