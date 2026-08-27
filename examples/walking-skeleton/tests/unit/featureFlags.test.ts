import { describe, it, expect } from 'vitest'
import { isResourcesEnabled } from '@/shared/featureFlags'

describe('isResourcesEnabled', () => {
  it('true quando RESOURCES_ENABLED=on', () => {
    expect(isResourcesEnabled({ RESOURCES_ENABLED: 'on' })).toBe(true)
  })
  it('false quando off', () => {
    expect(isResourcesEnabled({ RESOURCES_ENABLED: 'off' })).toBe(false)
  })
  it('false quando ausente (fail-closed)', () => {
    expect(isResourcesEnabled({})).toBe(false)
  })
})
