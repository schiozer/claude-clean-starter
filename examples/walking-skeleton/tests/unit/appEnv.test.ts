import { describe, it, expect } from 'vitest'
import { isDevEnvironment, isE2eLocalEnvironment } from '@/shared/appEnv'

describe('isDevEnvironment', () => {
  it('true só com APP_ENV=development fora de build de produção', () => {
    expect(isDevEnvironment({ APP_ENV: 'development', NODE_ENV: 'development' })).toBe(true)
  })
  it('ausente → não é Dev (fail-closed)', () => {
    expect(isDevEnvironment({ NODE_ENV: 'development' })).toBe(false)
  })
  it('APP_ENV=development copiado para um deploy (NODE_ENV=production) → não é Dev', () => {
    expect(isDevEnvironment({ APP_ENV: 'development', NODE_ENV: 'production' })).toBe(false)
  })
})

describe('isE2eLocalEnvironment', () => {
  it('true só com APP_ENV=e2e e sem VERCEL', () => {
    expect(isE2eLocalEnvironment({ APP_ENV: 'e2e' })).toBe(true)
  })
  it('APP_ENV=e2e num deploy da Vercel (VERCEL=1) → false (fail-closed)', () => {
    expect(isE2eLocalEnvironment({ APP_ENV: 'e2e', VERCEL: '1' })).toBe(false)
  })
  it('outros APP_ENV ou ausente → false', () => {
    expect(isE2eLocalEnvironment({ APP_ENV: 'development' })).toBe(false)
    expect(isE2eLocalEnvironment({})).toBe(false)
  })
})
