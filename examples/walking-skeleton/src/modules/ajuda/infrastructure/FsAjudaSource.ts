import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { logError } from '@/shared/logError'
import { ajudaDocSchema, contextoDoCenario, type AjudaDoc } from '../application/dto'
import type { IAjudaSource } from '../application/IAjudaSource'
import { ID_CENARIO } from '../application/schemas'

const naoExiste = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')

/**
 * Páginas de ajuda em arquivos: `<dir>/<CTX>/<ID>.json` e `<dir>/<CTX>/<ID>/<NN>.png`. Sem a pasta
 * → lista vazia. Arquivo inválido sai da lista (e vai para o log), nunca derruba a página.
 */
export class FsAjudaSource implements IAjudaSource {
  constructor(private readonly dir: string) {}

  async list(): Promise<AjudaDoc[]> {
    const contextos = await this.entradas(this.dir)
    const docs: AjudaDoc[] = []
    for (const ctx of contextos.sort()) {
      const arquivos = (await this.entradas(join(this.dir, ctx))).filter((a) => a.endsWith('.json'))
      for (const arquivo of arquivos.sort()) {
        const doc = await this.get(arquivo.slice(0, -'.json'.length))
        if (doc) docs.push(doc)
      }
    }
    return docs
  }

  async get(id: string): Promise<AjudaDoc | null> {
    if (!ID_CENARIO.test(id)) return null
    const bruto = await this.ler(join(this.dir, contextoDoCenario(id), `${id}.json`))
    if (!bruto) return null
    try {
      const doc = ajudaDocSchema.parse(JSON.parse(Buffer.from(bruto).toString('utf8')))
      return doc.id === id ? doc : null
    } catch (error) {
      logError(`ajuda:FsAjudaSource:${id}`, error)
      return null
    }
  }

  async imagem(id: string, n: number): Promise<Uint8Array | null> {
    if (!ID_CENARIO.test(id) || !Number.isInteger(n) || n < 1) return null
    const nome = `${String(n).padStart(2, '0')}.png`
    return this.ler(join(this.dir, contextoDoCenario(id), id, nome))
  }

  private async entradas(dir: string): Promise<string[]> {
    try {
      return await readdir(dir)
    } catch (error) {
      if (naoExiste(error)) return []
      throw error
    }
  }

  private async ler(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(path))
    } catch (error) {
      if (naoExiste(error)) return null
      throw error
    }
  }
}
