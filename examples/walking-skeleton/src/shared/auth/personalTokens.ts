import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { isDevEnvironment } from '@/shared/appEnv'
import { UnauthorizedError } from '@/shared/errors'
import { systemClock, type Clock } from '@/shared/kernel'
import type { AuthUser } from './AuthUser'
import type { IAccessTokenVerifier } from './IAccessTokenVerifier'

export const PAT_PREFIX = 'pat_'
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000
const MIN_TOKEN_LENGTH = 32

/** Espelha a tabela `personal_access_tokens` (in-memory no skeleton). */
export interface PersonalTokenRecord {
  id: string
  userId: string
  tenantId: string
  tokenHash: string
  scopes: string[]
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
  devOnly: boolean
}

export interface IssueTokenInput {
  userId: string
  tenantId: string
  scopes: string[]
  expiresAt?: Date
  /** Só para o token de Dev vindo do env; o padrão é gerar um aleatório. */
  token?: string
  devOnly?: boolean
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class InMemoryPersonalTokenStore {
  private byHash = new Map<string, PersonalTokenRecord>()

  constructor(private readonly clock: Clock = systemClock) {}

  async issue(input: IssueTokenInput): Promise<string> {
    const token = input.token ?? `${PAT_PREFIX}${randomBytes(32).toString('base64url')}`
    if (!token.startsWith(PAT_PREFIX) || token.length < MIN_TOKEN_LENGTH) {
      throw new Error(`Token pessoal precisa começar com ${PAT_PREFIX} e ter ${MIN_TOKEN_LENGTH}+ caracteres`)
    }
    const now = this.clock.now()
    const record: PersonalTokenRecord = {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      tokenHash: hashToken(token),
      scopes: [...input.scopes],
      createdAt: now,
      expiresAt: input.expiresAt ?? new Date(now.getTime() + DEFAULT_TTL_MS),
      revokedAt: null,
      lastUsedAt: null,
      devOnly: input.devOnly ?? false,
    }
    this.byHash.set(record.tokenHash, record)
    return token
  }

  async revoke(token: string): Promise<void> {
    const record = this.byHash.get(hashToken(token))
    if (record) record.revokedAt = this.clock.now()
  }

  async findByHash(tokenHash: string): Promise<PersonalTokenRecord | null> {
    const record = this.byHash.get(tokenHash)
    return record ? { ...record, scopes: [...record.scopes] } : null
  }

  async touch(id: string, at: Date): Promise<void> {
    for (const record of this.byHash.values()) {
      if (record.id === id) record.lastUsedAt = at
    }
  }

  clear(): void {
    this.byHash.clear()
  }
}

export class PersonalTokenVerifier implements IAccessTokenVerifier {
  constructor(
    private readonly store: InMemoryPersonalTokenStore,
    private readonly clock: Clock = systemClock
  ) {}

  async verify(token: string): Promise<AuthUser> {
    const record = await this.store.findByHash(hashToken(token))
    const now = this.clock.now()
    const isUsable =
      record !== null &&
      record.revokedAt === null &&
      record.expiresAt > now &&
      (!record.devOnly || isDevEnvironment())
    if (!record || !isUsable) throw new UnauthorizedError('Token inválido, expirado ou revogado')
    await this.store.touch(record.id, now)
    return { id: record.userId, tenantId: record.tenantId, scopes: record.scopes, via: 'pat' }
  }
}
