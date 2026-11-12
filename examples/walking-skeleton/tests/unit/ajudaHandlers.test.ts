import { describe, expect, it, vi } from 'vitest'
import { AjudaService, makeAjudaHandlers, type AjudaDoc, type IAjudaSource } from '@/modules/ajuda'
import type { AuthUser, ResolveActor } from '@/shared/auth'
import { UnauthorizedError } from '@/shared/errors'
import { makeActor } from '../helpers/makeActor'

const PUBLICO: AjudaDoc = {
  id: 'CT-RES-001',
  titulo: 'Criar um recurso',
  perfil: 'usuário final',
  passos: [{ texto: 'Dado que estou logado', imagem: '01.png' }],
}
const INTERNO: AjudaDoc = { ...PUBLICO, id: 'CT-RES-006', perfil: 'time interno' }

const source: IAjudaSource = {
  list: async () => [PUBLICO, INTERNO],
  get: async (id) => [PUBLICO, INTERNO].find((d) => d.id === id) ?? null,
  imagem: async () => new Uint8Array([137, 80, 78, 71]),
}

const handlers = (actor: AuthUser | null) => {
  const resolve: ResolveActor = async () => {
    if (!actor) throw new UnauthorizedError()
    return actor
  }
  return makeAjudaHandlers(new AjudaService(source), resolve)
}

const req = new Request('http://localhost/ajuda')
const usuario = makeActor({ scopes: ['ajuda:read'] })
const params = (id: string, n: string) => ({ params: Promise.resolve({ id, n }) })

describe('bordas da ajuda', () => {
  it('listar sem sessão → UNAUTHORIZED traduzido', async () => {
    expect(await handlers(null).listar(req)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
  })

  it('listar do usuário final não traz o interno', async () => {
    const r = await handlers(usuario).listar(req)
    expect(r.ok && r.valor.map((d) => d.id)).toEqual(['CT-RES-001'])
  })

  it('abrir doc interno sem ajuda:interno → NOT_FOUND', async () => {
    expect(await handlers(usuario).abrir(req, 'CT-RES-006')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
  })

  it('abrir com ID fora do padrão → NOT_FOUND', async () => {
    expect(await handlers(usuario).abrir(req, '..%2Fx')).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('erro técnico → mensagem genérica e log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const quebrada = makeAjudaHandlers(
      new AjudaService({ ...source, list: async () => Promise.reject(new Error('disco')) }),
      async () => usuario
    )
    const r = await quebrada.listar(req)
    expect(r).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' })
    expect(!r.ok && r.mensagem).toMatch(/tente novamente/i)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('imagem: 200 image/png privada para quem pode ver', async () => {
    const res = await handlers(usuario).imagem(req, params('CT-RES-001', '1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toMatch(/private/)
  })

  it('imagem: sem sessão → 401; interno sem escopo → 404; passo inválido → 400', async () => {
    expect((await handlers(null).imagem(req, params('CT-RES-001', '1'))).status).toBe(401)
    expect((await handlers(usuario).imagem(req, params('CT-RES-006', '1'))).status).toBe(404)
    expect((await handlers(usuario).imagem(req, params('CT-RES-001', 'x'))).status).toBe(400)
  })

  it.each(['..%2Fx', '../x', '..%2F..%2Fdocs%2Fajuda%2FRES%2FCT-RES-001', 'CT-RES-001/..'])(
    'imagem com id de traversal %s → 400, sem ler arquivo',
    async (id) => {
      expect((await handlers(usuario).imagem(req, params(id, '1'))).status).toBe(400)
    }
  )

  it('imagem: sem ajuda:read → 403', async () => {
    const res = await handlers(makeActor({ scopes: [] })).imagem(req, params('CT-RES-001', '1'))
    expect(res.status).toBe(403)
  })
})
