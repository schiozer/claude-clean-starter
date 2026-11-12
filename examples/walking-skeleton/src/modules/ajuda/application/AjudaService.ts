import type { z } from 'zod'
import { hasScope, requireScope, type AuthUser } from '@/shared/auth'
import { NotFoundError, ValidationError } from '@/shared/errors'
import type { CatalogoIndice } from './catalogo'
import {
  toAjudaDocDTO,
  type AjudaDoc,
  type AjudaDocDTO,
  type VideoDoTreinamento,
  type VideosDaAjuda,
} from './dto'
import type { IAjudaSource } from './IAjudaSource'
import { SEM_EMBEDS, type IEmbeds, type IVideosDaAjuda } from './IVideosDaAjuda'
import { getAjudaSchema, imagemAjudaSchema } from './schemas'

const LEITURA = 'ajuda:read'
const INTERNO = 'ajuda:interno'
const INTERNO_PERFIL = 'time interno'

/**
 * Ajuda gerada dos cenários `@doc` (spec e2e-regressao-docs §9.1). Página `time interno` exige
 * `ajuda:interno`; sem ele, ela some da lista e responde "não encontrada" (não revela que existe).
 */
export class AjudaService {
  /**
   * `videos === null` → `desligado`. O `makeEmbeds` padrão não monta URL nenhuma (`SEM_EMBEDS`,
   * fail-closed); a composition injeta o `BunnyEmbeds` com `BUNNY_STREAM_TOKEN_KEY`.
   */
  constructor(
    private readonly source: IAjudaSource,
    private readonly videos: IVideosDaAjuda | null = null,
    private readonly makeEmbeds: (libraryId: string) => IEmbeds = () => SEM_EMBEDS
  ) {}

  async list(actor: AuthUser): Promise<AjudaDocDTO[]> {
    requireScope(actor, LEITURA)
    const docs = await this.source.list()
    return docs.filter((d) => this.podeVer(actor, d)).map((d) => toAjudaDocDTO(d))
  }

  async get(actor: AuthUser, input: { id: string }): Promise<AjudaDocDTO> {
    requireScope(actor, LEITURA)
    const doc = await this.docVisivel(actor, this.validar(getAjudaSchema, input).id)
    return toAjudaDocDTO(doc, await this.videosDe(actor, doc))
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

  private async videosDe(actor: AuthUser, doc: AjudaDoc): Promise<VideosDaAjuda> {
    if (!this.videos) return { estado: 'desligado' }
    const indice = await this.videos.indice()
    if (!indice) return { estado: 'indisponivel' }
    const embeds = this.makeEmbeds(indice.libraryId)
    return {
      estado: 'ok',
      demo: this.demoDe(indice, embeds, doc, actor),
      treinamento: this.treinamentoDe(indice, embeds, actor),
    }
  }

  /** Fail-closed: é interno se o doc OU o vídeo do catálogo for `time interno`. */
  private demoDe(indice: CatalogoIndice, embeds: IEmbeds, doc: AjudaDoc, actor: AuthUser) {
    const demo = indice.demos[doc.id]
    const videoId = demo?.videos.desktop || demo?.videos.mobile
    if (!demo || !videoId) return null
    const interno = doc.perfil === INTERNO_PERFIL || demo.perfil === INTERNO_PERFIL
    if (interno && !hasScope(actor, INTERNO)) return null
    const embedUrl = embeds.url(videoId, { assinado: interno })
    return embedUrl ? { versao: demo.versao, embedUrl, titulo: demo.titulo } : null
  }

  private treinamentoDe(
    indice: CatalogoIndice,
    embeds: IEmbeds,
    actor: AuthUser
  ): VideoDoTreinamento[] {
    const itens: VideoDoTreinamento[] = []
    for (const trilha of indice.treinamento?.trilhas ?? []) {
      for (const item of trilha.itens) {
        // Fail-closed: é interno se a trilha OU o item for `time interno`.
        const interno = trilha.perfil === INTERNO_PERFIL || item.perfil === INTERNO_PERFIL
        if (interno && !hasScope(actor, INTERNO)) continue
        const videoId = item.videos.desktop || item.videos.mobile
        const embedUrl = videoId ? embeds.url(videoId, { assinado: interno }) : null
        if (embedUrl) itens.push({ id: item.id, titulo: item.titulo, embedUrl })
      }
    }
    return itens
  }

  private podeVer(actor: AuthUser, doc: AjudaDoc): boolean {
    return doc.perfil !== INTERNO_PERFIL || hasScope(actor, INTERNO)
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
