import { describe, it, expect } from 'vitest'
import { requireScope, assertOwnership, hasScope } from '@/shared/auth'
import { ForbiddenError } from '@/shared/errors'
import { makeActor } from '../helpers/makeActor'

describe('requireScope', () => {
  it('lança ForbiddenError quando o escopo não está no actor', () => {
    expect(() => requireScope(makeActor(), 'resources:read')).toThrow(ForbiddenError)
  })

  it('passa quando o escopo está presente', () => {
    expect(() => requireScope(makeActor({ scopes: ['resources:read'] }), 'resources:read')).not.toThrow()
  })

  it('não aceita escopo parecido (prefixo)', () => {
    expect(hasScope(makeActor({ scopes: ['resources:readx'] }), 'resources:read')).toBe(false)
  })
})

describe('assertOwnership', () => {
  it('lança ForbiddenError quando o recurso é de outro usuário', () => {
    expect(() => assertOwnership(makeActor({ id: 'ana' }), 'bia')).toThrow(ForbiddenError)
  })

  it('passa para o próprio dono', () => {
    expect(() => assertOwnership(makeActor({ id: 'ana' }), 'ana')).not.toThrow()
  })
})
