import { z } from 'zod'
import { PERFIS_AJUDA } from './dto'

/**
 * Espelha os typedefs de `scripts/demos/catalogo.mjs` (publicado em `catalogo/index.json`). Os IDs
 * do Bunny entram na URL do embed: `libraryId` só dígitos e `videoId` só `[A-Za-z0-9-]` (guid).
 */
const libraryIdSchema = z.string().regex(/^\d+$/)
const videoIdSchema = z.string().regex(/^[A-Za-z0-9-]+$/)

const videosDoCenarioSchema = z.object({
  desktop: videoIdSchema.optional(),
  mobile: videoIdSchema.optional(),
})

export const itemDoCatalogoSchema = z.object({
  id: z.string(),
  titulo: z.string(),
  /** Sigla do contexto (`RES`), como no app. */
  contexto: z.string(),
  perfil: z.enum(PERFIS_AJUDA),
  videos: videosDoCenarioSchema,
})

export const catalogoIndiceSchema = z.object({
  formato: z.literal(1),
  atualizadoEm: z.string(),
  libraryId: libraryIdSchema,
  versoes: z.array(z.string()),
  demos: z.record(itemDoCatalogoSchema.extend({ versao: z.string() })),
  treinamento: z
    .object({
      versao: z.string(),
      trilhas: z.array(z.object({ perfil: z.string(), itens: z.array(itemDoCatalogoSchema) })),
    })
    .nullable(),
})

export type ItemDoCatalogo = z.infer<typeof itemDoCatalogoSchema>
export type CatalogoIndice = z.infer<typeof catalogoIndiceSchema>
