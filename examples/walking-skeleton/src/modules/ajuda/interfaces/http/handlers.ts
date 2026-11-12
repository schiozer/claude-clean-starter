import type { ResolveActor } from '@/shared/auth'
import { AppError } from '@/shared/errors'
import { handleApiError } from '@/shared/handleApiError'
import { logError } from '@/shared/logError'
import type { AjudaService } from '../../application/AjudaService'
import type { AjudaDocDTO } from '../../application/dto'
import { getAjudaSchema, imagemAjudaSchema } from '../../application/schemas'

/** Resultado para as páginas (server components): o dado ou o erro já traduzido. */
export type AjudaResultado<T> =
  { ok: true; valor: T } | { ok: false; code: string; mensagem: string }

const MENSAGEM_TECNICA = 'Não foi possível carregar a ajuda. Tente novamente.'

const traduzir = (
  error: unknown,
  contexto: string
): { ok: false; code: string; mensagem: string } => {
  if (error instanceof AppError) return { ok: false, code: error.code, mensagem: error.message }
  logError(contexto, error)
  return { ok: false, code: 'INTERNAL_ERROR', mensagem: MENSAGEM_TECNICA }
}

interface ImagemParams {
  params: Promise<{ id: string; n: string }>
}

/** Bordas da ajuda: as páginas `/ajuda` e `/ajuda/[id]` e a rota das imagens. */
export const makeAjudaHandlers = (service: AjudaService, resolveActor: ResolveActor) => ({
  async listar(req: Request): Promise<AjudaResultado<AjudaDocDTO[]>> {
    try {
      const actor = await resolveActor(req)
      return { ok: true, valor: await service.list(actor) }
    } catch (error) {
      return traduzir(error, 'ajuda:listar')
    }
  },

  async abrir(req: Request, id: string): Promise<AjudaResultado<AjudaDocDTO>> {
    try {
      const actor = await resolveActor(req)
      const input = getAjudaSchema.safeParse({ id })
      if (!input.success)
        return { ok: false, code: 'NOT_FOUND', mensagem: 'Página de ajuda não encontrada' }
      return { ok: true, valor: await service.get(actor, input.data) }
    } catch (error) {
      return traduzir(error, 'ajuda:abrir')
    }
  },

  /** `GET /api/ajuda/[id]/imagem/[n]`: o screenshot do passo, com o mesmo guard da página. */
  async imagem(req: Request, { params }: ImagemParams): Promise<Response> {
    try {
      const actor = await resolveActor(req)
      const input = imagemAjudaSchema.parse(await params)
      const png = await service.imagem(actor, input)
      return new Response(new Uint8Array(png), {
        headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' },
      })
    } catch (error) {
      return handleApiError(error, 'api/ajuda/imagem:GET')
    }
  },
})

export type AjudaHandlers = ReturnType<typeof makeAjudaHandlers>
