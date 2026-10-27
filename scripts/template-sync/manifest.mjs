// Manifesto do template sync (spec 2026-10-27 template-sync §5.1): o que é "do template".

export const MANIFEST_PATH = 'template-sync.manifest.json'

/** @typedef {{ managed: string[], ignore: string[] }} Manifest */

const escape = (text) => text.replace(/[.+^${}()|[\]\\?]/g, '\\$&')

/** `**` casa qualquer coisa (inclusive `/`), `*` casa sem `/`, `**\/` casa zero ou mais diretórios. */
export function globToRegExp(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?'
      i += 2
    } else if (glob.startsWith('**', i)) {
      source += '.*'
      i += 1
    } else if (glob[i] === '*') {
      source += '[^/]*'
    } else {
      source += escape(glob[i])
    }
  }
  return new RegExp(`^${source}$`)
}

const isStringArray = (value) => Array.isArray(value) && value.every((v) => typeof v === 'string')

/** @returns {Manifest} */
export function parseManifest(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Manifesto inválido: esperado um objeto { managed, ignore }.')
  }
  const { managed, ignore = [] } = /** @type {Record<string, unknown>} */ (json)
  if (!isStringArray(managed)) throw new Error('Manifesto inválido: managed deve ser lista de globs.')
  if (!isStringArray(ignore)) throw new Error('Manifesto inválido: ignore deve ser lista de globs.')
  return { managed, ignore }
}

/** Gerenciado = casa algum `managed` da união e nenhum `ignore` da união. */
export function makeMatcher(...manifests) {
  const managed = manifests.flatMap((m) => m.managed).map(globToRegExp)
  const ignore = manifests.flatMap((m) => m.ignore).map(globToRegExp)
  return (path) => managed.some((re) => re.test(path)) && !ignore.some((re) => re.test(path))
}
