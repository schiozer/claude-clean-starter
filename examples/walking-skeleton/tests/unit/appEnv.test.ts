import { describe, it, expect } from 'vitest'
import { isDevEnvironment } from '@/shared/appEnv'

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
