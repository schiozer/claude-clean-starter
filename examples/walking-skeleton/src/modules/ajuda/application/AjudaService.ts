import type { z } from 'zod'
import { hasScope, requireScope, type AuthUser } from '@/shared/auth'
import { NotFoundError, ValidationError } from '@/shared/errors'
import { toAjudaDocDTO, type AjudaDoc, type AjudaDocDTO } from './dto'
import type { IAjudaSource } from './IAjudaSource'
import { getAjudaSchema, imagemAjudaSchema } from './schemas'

const LEITURA = 'ajuda:read'
const INTERNO = 'ajuda:interno'

/**
 * Ajuda gerada dos cenários `@doc` (spec e2e-regressao-docs §9.1). Página `time interno` exige
 * `ajuda:interno`; sem ele, ela some da lista e responde "não encontrada" (não revela que existe).
 */
export class AjudaService {
  constructor(private readonly source: IAjudaSource) {}

  async list(actor: AuthUser): Promise<AjudaDocDTO[]> {
    requireScope(actor, LEITURA)
    const docs = await this.source.list()
    return docs.filter((d) => this.podeVer(actor, d)).map(toAjudaDocDTO)
  }

  async get(actor: AuthUser, input: { id: string }): Promise<AjudaDocDTO> {
    requireScope(actor, LEITURA)
    return toAjudaDocDTO(await this.docVisivel(actor, this.validar(getAjudaSchema, input).id))
  }

  async imagem(actor: AuthUser, input: { id: string; n: number }): Promise<Uint8Array> {
    requireScope(actor, LEITURA)
    const { id, n } = this.validar(imagemAjudaSchema, input)
    const doc = await this.docVisivel(actor, id)
    if (n > doc.passos.length) throw new NotFoundError('Imagem', 'Imagem não encontrada')
    const imagem = await this.source.imagem(id, n)
    if (!imagem) throw new NotFoundError('Imagem', 'Imagem não encontrada')
    return imagem
  }

  private podeVer(actor: AuthUser, doc: AjudaDoc): boolean {
    return doc.perfil !== 'time interno' || hasScope(actor, INTERNO)
  }

  private async docVisivel(actor: AuthUser, id: string): Promise<AjudaDoc> {
    const doc = await this.source.get(id)
    if (!doc || !this.podeVer(actor, doc))
      throw new NotFoundError('Página de ajuda', 'Página de ajuda não encontrada')
    return doc
  }

  /** O ID vira caminho de arquivo na fonte: valida aqui também, não só na borda. */
  private validar<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
    const r = schema.safeParse(input)
    if (!r.success) throw new ValidationError('Página de ajuda inválida')
    return r.data
  }
}
