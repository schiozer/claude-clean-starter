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
}

export const contextoDoCenario = (id: string): string => id.split('-')[1] ?? id

export function toAjudaDocDTO(doc: AjudaDoc): AjudaDocDTO {
  return {
    id: doc.id,
    titulo: doc.titulo,
    perfil: doc.perfil,
    contexto: contextoDoCenario(doc.id),
    passos: doc.passos.map((p) => ({ texto: p.texto, imagem: p.imagem })),
  }
}
