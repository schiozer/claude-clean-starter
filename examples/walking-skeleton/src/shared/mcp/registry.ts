import { hasScope, type AuthUser } from '@/shared/auth'
import { isEnabled } from '@/shared/featureFlags'
import type { AnyTool } from './defineTool'

type Env = Record<string, string | undefined>

/** Só aparecem as tools com flag ligada E escopo presente no ator (fail-closed). */
export function visibleTools<T extends AnyTool>(tools: readonly T[], actor: AuthUser, env: Env = process.env): T[] {
  return tools.filter((tool) => isEnabled(tool.flag, env) && hasScope(actor, tool.scope))
}

/** Falha no boot se o catálogo for incoerente: nomes únicos e escrita só atrás de flag `.write`. */
export function assertValidTools(tools: readonly AnyTool[]): void {
  const seen = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`Tool MCP duplicada: ${tool.name}`)
    if (tool.scope.endsWith(':write') && !tool.flag.endsWith('.write')) {
      throw new Error(`Tool MCP ${tool.name}: escopo de escrita exige flag .write (desligada por padrão)`)
    }
    seen.add(tool.name)
  }
}
