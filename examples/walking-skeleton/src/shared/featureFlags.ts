import { NotFoundError } from '@/shared/errors'

type Env = Record<string, string | undefined>

interface FlagDef {
  envVar: string
  defaultOn: boolean
  /** Flag-mãe: desligada, desliga esta também (o kill switch da feature cobre o MCP). */
  requires?: 'resources'
}

const FLAGS = {
  resources: { envVar: 'RESOURCES_ENABLED', defaultOn: false },
  'mcp.resources.read': { envVar: 'MCP_RESOURCES_READ', defaultOn: true, requires: 'resources' },
  'mcp.resources.write': { envVar: 'MCP_RESOURCES_WRITE', defaultOn: false, requires: 'resources' },
} as const satisfies Record<string, FlagDef>

export type FlagName = keyof typeof FLAGS

export function isEnabled(flag: FlagName, env: Env = process.env): boolean {
  const def: FlagDef = FLAGS[flag]
  if (def.requires && !isEnabled(def.requires, env)) return false
  const { envVar, defaultOn } = def
  const value = env[envVar]
  if (value === 'on') return true
  if (value === 'off') return false
  return defaultOn
}

export function ensureEnabled(flag: FlagName, env: Env = process.env): void {
  if (!isEnabled(flag, env)) throw new NotFoundError('Recurso')
}
