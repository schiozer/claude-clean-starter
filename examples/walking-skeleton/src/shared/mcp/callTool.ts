import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { requireScope, type AuthUser } from '@/shared/auth'
import { isEnabled } from '@/shared/featureFlags'
import { systemClock, type Clock } from '@/shared/kernel'
import { logError } from '@/shared/logError'
import type { IAuditLog } from './audit'
import type { AnyTool } from './defineTool'
import type { IRateLimiter } from './rateLimit'
import { toToolError, toolError } from './toToolError'
import { estimateTokens, type IUsageMeter, type UsageEntry } from './usage'

const DEFAULT_USAGE_TIMEOUT_MS = 500

type Env = Record<string, string | undefined>

export interface CallToolDeps {
  rateLimiter: IRateLimiter
  audit: IAuditLog
  usage: IUsageMeter
  /** Teto de espera do registro de uso (vale para o medidor composto inteiro). */
  usageTimeoutMs?: number
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

  const clock = deps.clock ?? systemClock
  const startedAt = clock.now()
  const result = await execute(tool, actor, args, deps)

  if (isEnabled('observabilidade.uso-mcp', deps.env ?? process.env)) {
    await recordUsage(tool, actor, result, clock.now().getTime() - startedAt.getTime(), deps)
  }
  if (!tool.annotations.readOnlyHint) await audit(tool, actor, result, deps)
  return result
}

/** Só os blocos `text` contam: o `structuredContent` repete o mesmo dado. */
export function countOutputTokens(result: CallToolResult): number {
  return result.content.reduce(
    (total, block) => (block.type === 'text' ? total + estimateTokens(block.text) : total),
    0
  )
}

/** Fail-open: a medição nunca altera nem atrasa (além do timeout) a resposta da tool. */
async function recordUsage(
  tool: AnyTool,
  actor: AuthUser,
  result: CallToolResult,
  latencyMs: number,
  deps: CallToolDeps
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const entry: UsageEntry = {
      at: (deps.clock ?? systemClock).now().toISOString(),
      tenantId: actor.tenantId,
      tool: tool.name,
      outcome: result.isError ? 'error' : 'ok',
      ...(result.isError ? { code: String(result._meta?.code ?? 'INTERNAL_ERROR') } : {}),
      latencyMs,
      outputTokensEst: countOutputTokens(result),
    }
    const recording = (async () => deps.usage.record(entry))()
    // Depois do timeout a promise pode rejeitar sozinha; absorve para não virar unhandledRejection.
    recording.catch(() => {})
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('timeout ao registrar o uso')),
        deps.usageTimeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS
      )
    })
    await Promise.race([recording, timeout])
  } catch (error) {
    logError('mcp:usage', error)
  } finally {
    clearTimeout(timer)
  }
}

/** A escrita já aconteceu: falha da auditoria é logada, nunca devolvida como erro à LLM. */
async function audit(tool: AnyTool, actor: AuthUser, result: CallToolResult, deps: CallToolDeps): Promise<void> {
  const code = result.isError ? String(result._meta?.code ?? 'INTERNAL_ERROR') : undefined
  try {
    await deps.audit.record({
      at: (deps.clock ?? systemClock).now().toISOString(),
      actorId: actor.id,
      tenantId: actor.tenantId,
      via: actor.via,
      tool: tool.name,
      outcome: result.isError ? 'error' : 'ok',
      ...(code ? { code } : {}),
    })
  } catch (error) {
    logError('mcp:audit', error)
  }
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
