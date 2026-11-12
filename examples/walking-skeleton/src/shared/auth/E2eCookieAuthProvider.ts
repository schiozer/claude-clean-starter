import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { isE2eLocalEnvironment } from '@/shared/appEnv'
import type { Clock } from '@/shared/kernel'
import type { AuthUser } from './AuthUser'
import type { IAuthProvider } from './session'

type Env = Record<string, string | undefined>

export type E2ePerfil = 'usuario' | 'interno'

export const E2E_SESSION_COOKIE = 'e2e_session'

const HORA_MS = 60 * 60 * 1000
const DEFAULT_IDLE_MS = 8 * HORA_MS
const DEFAULT_MAX_MS = 7 * 24 * HORA_MS
const MIN_SECRET_LENGTH = 16

const PERFIS: Record<E2ePerfil, string[]> = {
  usuario: ['resources:read', 'resources:write', 'ajuda:read'],
  interno: ['resources:read', 'resources:write', 'ajuda:read', 'ajuda:interno'],
}

export function isE2ePerfil(value: unknown): value is E2ePerfil {
  return value === 'usuario' || value === 'interno'
}

export interface E2eSession {
  sessionId: string
  perfil: E2ePerfil
  issuedAt: number
  lastSeen: number
}

export interface E2eSessionConfig {
  secret: string
  idleMs: number
  maxMs: number
}

/** Opções da verificação pura (usada pelo provider e pelo middleware). */
export interface E2eVerifyOptions extends E2eSessionConfig {
  now: number
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Config da sessão e2e a partir do env; segredo ausente/curto → erro (sem expor o valor). */
export function loadE2eSessionConfig(env: Env = process.env): E2eSessionConfig {
  const secret = env.E2E_SESSION_SECRET ?? ''
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `E2E_SESSION_SECRET ausente ou curto (mínimo ${MIN_SECRET_LENGTH} caracteres) no modo e2e`
    )
  }
  return {
    secret,
    idleMs: positiveInt(env.E2E_SESSION_IDLE_MS, DEFAULT_IDLE_MS),
    maxMs: positiveInt(env.E2E_SESSION_MAX_MS, DEFAULT_MAX_MS),
  }
}

const payloadOf = (s: E2eSession): string =>
  `${s.sessionId}.${s.perfil}.${s.issuedAt}.${s.lastSeen}`

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('hex')

function signatureMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

function setCookie(value: string, maxAgeSeconds: number): string {
  return `${E2E_SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`
}

function cookieFor(session: E2eSession, config: E2eSessionConfig): string {
  const payload = payloadOf(session)
  return setCookie(`${payload}.${sign(payload, config.secret)}`, Math.floor(config.idleMs / 1000))
}

/** Valor do cookie `e2e_session` no header `Cookie` da requisição. */
export function readE2eSessionCookie(req: Request): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === E2E_SESSION_COOKIE) return rest.join('=') || null
  }
  return null
}

/**
 * Sessão por cookie assinado (HMAC-SHA256 de `sessionId.perfil.issuedAt.lastSeen`) **só** para o
 * modo E2E local (`isE2eLocalEnvironment()`); em qualquer outro ambiente não autentica ninguém.
 * Inatividade (`idleMs`) conta a partir de `lastSeen`, renovado pelo middleware a cada tela.
 */
export class E2eCookieAuthProvider implements IAuthProvider {
  private readonly revoked = new Set<string>()

  constructor(private readonly opts: E2eSessionConfig & { clock: Clock }) {}

  /** Verificação pura: assinatura, perfil e prazos. Inválido ou malformado → `null`. */
  static verify(value: string, opts: E2eVerifyOptions): E2eSession | null {
    const parts = value.split('.')
    if (parts.length !== 5) return null
    const [sessionId, perfil, issuedAtRaw, lastSeenRaw, signature] = parts as [
      string,
      string,
      string,
      string,
      string,
    ]
    if (!sessionId || !isE2ePerfil(perfil)) return null
    const issuedAt = Number(issuedAtRaw)
    const lastSeen = Number(lastSeenRaw)
    if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(lastSeen)) return null
    const session: E2eSession = { sessionId, perfil, issuedAt, lastSeen }
    if (!signatureMatches(sign(payloadOf(session), opts.secret), signature)) return null
    if (lastSeen < issuedAt) return null
    if (opts.now - lastSeen > opts.idleMs || opts.now - issuedAt > opts.maxMs) return null
    return session
  }

  /** Renova `lastSeen` de uma sessão válida → novo `Set-Cookie`; inválida → `null`. */
  static renew(value: string, opts: E2eVerifyOptions): string | null {
    const session = E2eCookieAuthProvider.verify(value, opts)
    return session ? cookieFor({ ...session, lastSeen: opts.now }, opts) : null
  }

  /** `Set-Cookie` que apaga a sessão no navegador. */
  static clearCookie(): string {
    return setCookie('', 0)
  }

  issue(perfil: E2ePerfil): { cookie: string; sessionId: string } {
    const now = this.opts.clock.now().getTime()
    const session: E2eSession = { sessionId: randomUUID(), perfil, issuedAt: now, lastSeen: now }
    return { cookie: cookieFor(session, this.opts), sessionId: session.sessionId }
  }

  revoke(sessionId: string): void {
    this.revoked.add(sessionId)
  }

  /** Sessão válida e não revogada da requisição (só no modo e2e local). */
  sessionOf(req: Request): E2eSession | null {
    if (!isE2eLocalEnvironment()) return null
    const value = readE2eSessionCookie(req)
    if (!value) return null
    const session = E2eCookieAuthProvider.verify(value, {
      ...this.opts,
      now: this.opts.clock.now().getTime(),
    })
    if (!session || this.revoked.has(session.sessionId)) return null
    return session
  }

  async getUser(req: Request): Promise<AuthUser | null> {
    const session = this.sessionOf(req)
    if (!session) return null
    return {
      id: 'dev-user',
      tenantId: 'dev-tenant',
      scopes: [...PERFIS[session.perfil]],
      via: 'session',
    }
  }
}
