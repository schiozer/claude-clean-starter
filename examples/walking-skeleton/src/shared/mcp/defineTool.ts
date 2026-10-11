import type { z, ZodTypeAny } from 'zod'
import type { AuthUser } from '@/shared/auth'
import type { FlagName } from '@/shared/featureFlags'

export interface ReadToolAnnotations {
  readOnlyHint: true
}

export interface WriteToolAnnotations {
  readOnlyHint: false
  destructiveHint: boolean
  idempotentHint: boolean
}

/** Flag de escrita exige anotações honestas de escrita; as demais, leitura (ADR-012). */
export type ToolAnnotationsFor<F extends FlagName> = F extends `${string}.write`
  ? WriteToolAnnotations
  : ReadToolAnnotations

export interface ToolDefinition<
  I extends ZodTypeAny,
  O extends Record<string, unknown>,
  F extends FlagName,
> {
  name: string
  description: string
  input: I
  output?: ZodTypeAny
  scope: string
  flag: F
  annotations: ToolAnnotationsFor<F>
  handler: (actor: AuthUser, input: z.output<I>) => Promise<O>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDefinition<any, any, FlagName>

export function defineTool<I extends ZodTypeAny, O extends Record<string, unknown>, F extends FlagName>(
  tool: ToolDefinition<I, O, F>
): ToolDefinition<I, O, F> {
  return tool
}
