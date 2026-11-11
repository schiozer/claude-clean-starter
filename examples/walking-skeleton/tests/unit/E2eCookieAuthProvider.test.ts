// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { E2eCookieAuthProvider, loadE2eSessionConfig } from '@/shared/auth/E2eCookieAuthProvider'
import type { Clock } from '@/shared/kernel'

const SECRET = 'segredo-de-teste-0123456789'
const HORA = 60 * 60 * 1000
const IDLE = 8 * HORA
const MAX = 7 * 24 * HORA

let now = new Date('2026-01-01T00:00:00Z')
const clock: Clock = { now: () => now }
const avancar = (ms: number) => {
  now = new Date(now.getTime() + ms)
}

const valorDe = (setCookie: string): string => {
  const match = /^e2e_session=([^;]+)/.exec(setCookie)
  if (!match?.[1]) throw new Error('Set-Cookie sem e2e_session')
  return match[1]
}
const reqCom = (setCookie: string) =>
  new Request('http://localhost/api/resources', {
    headers: { cookie: `outro=1; e2e_session=${valorDe(setCookie)}` },
  })

describe('E2eCookieAuthProvider', () => {
  let provider: E2eCookieAuthProvider

  beforeEach(() => {
    now = new Date('2026-01-01T00:00:00Z')
    process.env.APP_ENV = 'e2e'
    delete process.env.VERCEL
    provider = new E2eCookieAuthProvider({ secret: SECRET, clock, idleMs: IDLE, maxMs: MAX })
  })
  afterEach(() => {
    delete process.env.APP_ENV
    delete process.env.VERCEL
  })

  it('cookie emitido autentica o perfil usuario sem ajuda:interno', async () => {
    const { cookie } = provider.issue('usuario')
    expect(await provider.getUser(reqCom(cookie))).toEqual({
      id: 'dev-user',
      tenantId: 'dev-tenant',
      scopes: ['resources:read', 'resources:write', 'ajuda:read'],
      via: 'session',
    })
  })

  it('perfil interno ganha ajuda:interno', async () => {
    const { cookie } = provider.issue('interno')
    expect((await provider.getUser(reqCom(cookie)))?.scopes).toEqual([
      'resources:read',
      'resources:write',
      'ajuda:read',
      'ajuda:interno',
    ])
  })

  it('sem cookie → null', async () => {
    expect(await provider.getUser(new Request('http://localhost/'))).toBeNull()
  })

  it('VERCEL=1 com APP_ENV=e2e → null (fail-closed)', async () => {
    const { cookie } = provider.issue('usuario')
    process.env.VERCEL = '1'
    expect(await provider.getUser(reqCom(cookie))).toBeNull()
  })

  it('APP_ENV=development → null', async () => {
    const { cookie } = provider.issue('usuario')
    process.env.APP_ENV = 'development'
    expect(await provider.getUser(reqCom(cookie))).toBeNull()
  })

  it('inativo além de idleMs → null', async () => {
    const { cookie } = provider.issue('usuario')
    avancar(IDLE)
    expect(await provider.getUser(reqCom(cookie))).not.toBeNull()
    avancar(1)
    expect(await provider.getUser(reqCom(cookie))).toBeNull()
  })

  it('além de maxMs mesmo ativo → null', async () => {
    let { cookie } = provider.issue('usuario')
    // Ativo a cada 6 h (< idleMs) até completar exatamente os 7 dias.
    for (let decorrido = 0; decorrido < MAX; decorrido += 6 * HORA) {
      avancar(6 * HORA)
      const opts = { secret: SECRET, now: now.getTime(), idleMs: IDLE, maxMs: MAX }
      const renovado = E2eCookieAuthProvider.renew(valorDe(cookie), opts)
      expect(renovado).not.toBeNull()
      cookie = renovado as string
    }
    expect(await provider.getUser(reqCom(cookie))).not.toBeNull()
    avancar(1)
    expect(await provider.getUser(reqCom(cookie))).toBeNull()
  })

  it('renovar mantém ativa além de idleMs desde a emissão', async () => {
    const { cookie } = provider.issue('usuario')
    avancar(6 * HORA)
    const renovado = E2eCookieAuthProvider.renew(valorDe(cookie), {
      secret: SECRET,
      now: now.getTime(),
      idleMs: IDLE,
      maxMs: MAX,
    })
    expect(renovado).not.toBeNull()
    avancar(6 * HORA)
    expect(await provider.getUser(reqCom(renovado as string))).not.toBeNull()
  })

  it('assinatura adulterada → null', async () => {
    const { cookie } = provider.issue('usuario')
    const adulterado = valorDe(cookie).replace('.usuario.', '.interno.')
    const req = new Request('http://localhost/', {
      headers: { cookie: `e2e_session=${adulterado}` },
    })
    expect(await provider.getUser(req)).toBeNull()
    const outroSegredo = new E2eCookieAuthProvider({
      secret: 'outro-segredo-0123456789',
      clock,
      idleMs: IDLE,
      maxMs: MAX,
    })
    expect(await outroSegredo.getUser(reqCom(cookie))).toBeNull()
  })

  it('valores malformados → null, sem lançar', () => {
    const opts = { secret: SECRET, now: now.getTime(), idleMs: IDLE, maxMs: MAX }
    for (const valor of ['', 'a.b.c', 'x.usuario.1.1.zz', 'a.admin.1.1.' + '0'.repeat(64)]) {
      expect(E2eCookieAuthProvider.verify(valor, opts)).toBeNull()
    }
  })

  it('revogado → null', async () => {
    const { cookie, sessionId } = provider.issue('usuario')
    provider.revoke(sessionId)
    expect(await provider.getUser(reqCom(cookie))).toBeNull()
  })

  it('Set-Cookie tem HttpOnly, Secure, SameSite=Lax e Max-Age=28800', () => {
    const { cookie } = provider.issue('usuario')
    const atributos = cookie.split(';').map((p) => p.trim())
    expect(atributos).toEqual(
      expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=28800'])
    )
    expect(E2eCookieAuthProvider.clearCookie()).toContain('Max-Age=0')
  })
})

describe('loadE2eSessionConfig', () => {
  it('padrão 8 h de inatividade e 7 dias de vida máxima', () => {
    expect(loadE2eSessionConfig({ E2E_SESSION_SECRET: SECRET })).toEqual({
      secret: SECRET,
      idleMs: IDLE,
      maxMs: MAX,
    })
  })

  it('lê E2E_SESSION_IDLE_MS e E2E_SESSION_MAX_MS', () => {
    const config = loadE2eSessionConfig({
      E2E_SESSION_SECRET: SECRET,
      E2E_SESSION_IDLE_MS: '1000',
      E2E_SESSION_MAX_MS: '5000',
    })
    expect([config.idleMs, config.maxMs]).toEqual([1000, 5000])
  })

  it('segredo ausente ou curto → erro sem expor o valor', () => {
    expect(() => loadE2eSessionConfig({})).toThrow('E2E_SESSION_SECRET')
    expect(() => loadE2eSessionConfig({ E2E_SESSION_SECRET: 'curto123' })).toThrow(
      /^(?!.*curto123)/
    )
  })
})
