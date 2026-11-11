import { TimeoutError } from '@/shared/errors'
import { handleApiError } from '@/shared/handleApiError'
import { logError } from '@/shared/logError'
import { e2eDelayMs } from './e2eFaults'

type RouteHandler = (req: Request) => Promise<Response>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Prazo da rota de API (RNF-TMO-001): estourou → 504 `TIMEOUT` tratado, sem pendurar. O atraso de
 * teste (`e2eDelayMs`) entra antes do handler e conta no prazo; se o prazo estoura durante o
 * atraso, o handler não roda. Já um handler **lento** que começou continua executando após o 504
 * (não há cancelamento): o efeito dele pode acontecer mesmo com o cliente tendo recebido o erro.
 */
export function withRouteTimeout(handler: RouteHandler, ms: number, context: string): RouteHandler {
  return async (req) => {
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<Response>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true
        const error = new TimeoutError()
        logError(context, error)
        resolve(handleApiError(error, context))
      }, ms)
    })
    const run = (async (): Promise<Response> => {
      const delay = e2eDelayMs(req)
      if (delay > 0) await sleep(delay)
      if (timedOut) return new Response(null, { status: 504 })
      return handler(req)
    })().catch((error: unknown) => handleApiError(error, context))
    try {
      return await Promise.race([run, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}
