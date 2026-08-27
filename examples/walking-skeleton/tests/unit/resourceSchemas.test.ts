import { describe, it, expect } from 'vitest'
import { createResourceSchema } from '@/application/validators/resourceSchemas'

describe('createResourceSchema', () => {
  it('aceita título válido', () => {
    expect(createResourceSchema.parse({ title: 'Válido' })).toEqual({ title: 'Válido' })
  })
  it('rejeita título curto', () => {
    expect(createResourceSchema.safeParse({ title: 'ab' }).success).toBe(false)
  })
})
