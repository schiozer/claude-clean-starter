import { NotFoundError } from '@/shared/errors'

type Env = Record<string, string | undefined>

const FLAGS = {
  resources: { envVar: 'RESOURCES_ENABLED', defaultOn: false },
  'mcp.resources.read': { envVar: 'MCP_RESOURCES_READ', defaultOn: true },
  'mcp.resources.write': { envVar: 'MCP_RESOURCES_WRITE', defaultOn: false },
} as const

export type FlagName = keyof typeof FLAGS

export function isEnabled(flag: FlagName, env: Env = process.env): boolean {
  const { envVar, defaultOn } = FLAGS[flag]
  const value = env[envVar]
  if (value === 'on') return true
  if (value === 'off') return false
  return defaultOn
}

export function ensureEnabled(flag: FlagName, env: Env = process.env): void {
  if (!isEnabled(flag, env)) throw new NotFoundError('Recurso')
}
