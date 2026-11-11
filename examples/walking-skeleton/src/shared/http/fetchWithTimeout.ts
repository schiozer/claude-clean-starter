import { TimeoutError } from '@/shared/errors'

export const UI_TIMEOUT_MS = 15_000

/**
 * `fetch` que desiste após `ms` (RNF-TMO-002) e rejeita com `TimeoutError`. Usa `setTimeout`,
 * então o `page.clock` do Playwright controla o prazo.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  ms: number = UI_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, ms)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut) throw new TimeoutError()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
