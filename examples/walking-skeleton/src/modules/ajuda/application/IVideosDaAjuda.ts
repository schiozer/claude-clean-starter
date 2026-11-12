import type { CatalogoIndice } from './catalogo'

/** Catálogo de vídeos. `null` = indisponível; nunca lança. */
export interface IVideosDaAjuda {
  indice(): Promise<CatalogoIndice | null>
}

/** Monta a URL de embed de um vídeo; `null` quando não dá para montá-la com segurança. */
export interface IEmbeds {
  url(videoId: string, opts: { assinado: boolean }): string | null
}
