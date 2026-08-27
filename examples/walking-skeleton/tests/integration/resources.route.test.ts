import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GET, POST } from '@/app/api/resources/route'
import { resourceRepository } from '@/infrastructure/composition'

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const getReq = () => new Request('http://localhost/api/resources')

describe('rota /api/resources (flag on)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'on'
    resourceRepository.clear()
  })
  afterEach(() => {
    delete process.env.RESOURCES_ENABLED
  })

  it('POST cria com título válido → 201', async () => {
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('Válido')
    expect(body.ownerId).toBe('dev-user')
  })

  it('POST com título inválido → 400 VALIDATION_ERROR', async () => {
    const res = await POST(postReq({ title: 'ab' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('VALIDATION_ERROR')
  })

  it('GET lista os resources do usuário → 200', async () => {
    await POST(postReq({ title: 'Item um' }))
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
  })
})

describe('rota /api/resources (flag off)', () => {
  beforeEach(() => {
    process.env.RESOURCES_ENABLED = 'off'
    resourceRepository.clear()
  })

  it('GET → 404 quando desligado', async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(404)
  })
  it('POST → 404 quando desligado', async () => {
    const res = await POST(postReq({ title: 'Válido' }))
    expect(res.status).toBe(404)
  })
})
