import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { requireScope, type AuthUser } from '@/shared/auth'
import { isEnabled } from '@/shared/featureFlags'
import { systemClock, type Clock } from '@/shared/kernel'
import type { IAuditLog } from './audit'
import type { AnyTool } from './defineTool'
import type { IRateLimiter } from './rateLimit'
import { toToolError, toolError } from './toToolError'

type Env = Record<string, string | undefined>

export interface CallToolDeps {
  rateLimiter: IRateLimiter
  audit: IAuditLog
  clock?: Clock
  env?: Env
}

export async function callTool(
  tools: readonly AnyTool[],
  actor: AuthUser,
  name: string,
  args: unknown,
  deps: CallToolDeps
): Promise<CallToolResult> {
  const tool = tools.find((t) => t.name === name)
  if (!tool || !isEnabled(tool.flag, deps.env ?? process.env)) {
    return toolError(`Tool não encontrada: ${name}`, 'NOT_FOUND')
  }

  const result = await execute(tool, actor, args, deps)

  if (!tool.annotations.readOnlyHint) {
    const code = result.isError ? String(result._meta?.code ?? 'INTERNAL_ERROR') : undefined
    await deps.audit.record({
      at: (deps.clock ?? systemClock).now().toISOString(),
      actorId: actor.id,
      tenantId: actor.tenantId,
      via: actor.via,
      tool: tool.name,
      outcome: result.isError ? 'error' : 'ok',
      ...(code ? { code } : {}),
    })
  }
  return result
}

async function execute(tool: AnyTool, actor: AuthUser, args: unknown, deps: CallToolDeps): Promise<CallToolResult> {
  try {
    requireScope(actor, tool.scope)
    await deps.rateLimiter.consume(`${actor.tenantId}:${actor.id}`)
    const input = tool.input.parse(args ?? {})
    const output = await tool.handler(actor, input)
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
  } catch (error) {
    return toToolError(error, `mcp:${tool.name}`)
  }
}
