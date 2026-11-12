import { z } from 'zod'

export const PERFIS_AJUDA = ['usuário final', 'time interno'] as const

/** Página de ajuda gerada por `npm run docs:gerar` (`docs/ajuda/<CTX>/<ID>.json`). */
export const ajudaDocSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  perfil: z.enum(PERFIS_AJUDA),
  passos: z.array(z.object({ texto: z.string(), imagem: z.string() })),
})
export type AjudaDoc = z.infer<typeof ajudaDocSchema>

/** Saída do service: a página + a sigla do contexto (`CT-RES-001` → `RES`). */
export interface AjudaDocDTO extends AjudaDoc {
  contexto: string
  videos: VideosDaAjuda
}

export interface VideoDoTreinamento {
  id: string
  titulo: string
  embedUrl: string
}

/** Vídeos da página: só o `get` lê o catálogo; `list` devolve sempre `desligado`. */
export type VideosDaAjuda =
  | { estado: 'desligado' }
  | { estado: 'indisponivel' }
  | {
      estado: 'ok'
      demo: { versao: string; embedUrl: string; titulo: string } | null
      treinamento: VideoDoTreinamento[]
    }

export const VIDEOS_DESLIGADOS: VideosDaAjuda = { estado: 'desligado' }

export const contextoDoCenario = (id: string): string => id.split('-')[1] ?? id

export function toAjudaDocDTO(
  doc: AjudaDoc,
  videos: VideosDaAjuda = VIDEOS_DESLIGADOS
): AjudaDocDTO {
  return {
    id: doc.id,
    titulo: doc.titulo,
    perfil: doc.perfil,
    contexto: contextoDoCenario(doc.id),
    videos,
    passos: doc.passos.map((p) => ({ texto: p.texto, imagem: p.imagem })),
  }
}
