import { describe, it, expect } from 'vitest'
import { isResourcesEnabled, isEnabled, ensureEnabled } from '@/shared/featureFlags'
import { NotFoundError } from '@/shared/errors'

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

describe('isEnabled', () => {
  it('mcp.resources.read nasce ligada', () => {
    expect(isEnabled('mcp.resources.read', {})).toBe(true)
  })
  it('mcp.resources.read pode ser desligada', () => {
    expect(isEnabled('mcp.resources.read', { MCP_RESOURCES_READ: 'off' })).toBe(false)
  })
  it('mcp.resources.write nasce desligada (fail-closed)', () => {
    expect(isEnabled('mcp.resources.write', {})).toBe(false)
    expect(isEnabled('mcp.resources.write', { MCP_RESOURCES_WRITE: 'yes' })).toBe(false)
  })
  it('mcp.resources.write liga só com on', () => {
    expect(isEnabled('mcp.resources.write', { MCP_RESOURCES_WRITE: 'on' })).toBe(true)
  })
  it('ensureEnabled lança NotFoundError quando desligada', () => {
    expect(() => ensureEnabled('resources', {})).toThrow(NotFoundError)
  })
})
