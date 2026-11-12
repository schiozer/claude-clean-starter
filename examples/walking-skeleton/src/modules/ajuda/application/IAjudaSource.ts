import type { AjudaDoc } from './dto'

/** Onde moram as páginas de ajuda geradas (no skeleton, os arquivos de `docs/ajuda/`). */
export interface IAjudaSource {
  list(): Promise<AjudaDoc[]>
  get(id: string): Promise<AjudaDoc | null>
  /** Screenshot do passo `n` (a partir de 1); `null` se não existir. */
  imagem(id: string, n: number): Promise<Uint8Array | null>
}
