export {
  getAjudaSchema,
  imagemAjudaSchema,
  type GetAjudaInput,
  type ImagemAjudaInput,
} from './application/schemas'
export {
  ajudaDocSchema,
  toAjudaDocDTO,
  type AjudaDoc,
  type AjudaDocDTO,
  type VideoDoTreinamento,
  type VideosDaAjuda,
} from './application/dto'
export { catalogoIndiceSchema, type CatalogoIndice } from './application/catalogo'
export type { IEmbeds, IVideosDaAjuda } from './application/IVideosDaAjuda'
export type { IAjudaSource } from './application/IAjudaSource'
export { AjudaService } from './application/AjudaService'
export {
  makeAjudaHandlers,
  type AjudaHandlers,
  type AjudaResultado,
} from './interfaces/http/handlers'
