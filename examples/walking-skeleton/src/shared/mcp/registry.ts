import { hasScope, type AuthUser } from '@/shared/auth'
import { isEnabled } from '@/shared/featureFlags'
import type { AnyTool } from './defineTool'

type Env = Record<string, string | undefined>

/** Só aparecem as tools com flag ligada E escopo presente no ator (fail-closed). */
export function visibleTools<T extends AnyTool>(tools: T[], actor: AuthUser, env: Env = process.env): T[] {
  return tools.filter((tool) => isEnabled(tool.flag, env) && hasScope(actor, tool.scope))
}

export function assertUniqueToolNames(tools: AnyTool[]): void {
  const seen = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`Tool MCP duplicada: ${tool.name}`)
    seen.add(tool.name)
  }
}
