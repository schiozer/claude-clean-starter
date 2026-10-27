// Acesso ao git do motor do template sync (spec 2026-10-27-template-sync-design.md §4).
import { execFileSync } from 'node:child_process'
import { MANIFEST_PATH, parseManifest } from './manifest.mjs'

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ input?: Buffer }} [opts]
 * @returns {Buffer}
 */
export function git(cwd, args, opts = {}) {
  return execFileSync('git', args, {
    cwd,
    input: opts.input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  })
}

/** @param {Buffer} out */
const splitZ = (out) => out.toString('utf8').split('\0').filter(Boolean)

/**
 * Blobs de uma revisão: caminho → sha. `rev` null → mapa vazio.
 * @param {string} repo
 * @param {string | null} rev
 * @returns {Map<string, string>}
 */
export function treeBlobs(repo, rev) {
  const blobs = new Map()
  if (rev === null) return blobs
  for (const line of splitZ(git(repo, ['ls-tree', '-r', '-z', rev]))) {
    const tab = line.indexOf('\t')
    const [, type, sha] = line.slice(0, tab).split(' ')
    if (type === 'blob') blobs.set(line.slice(tab + 1), sha)
  }
  return blobs
}

/**
 * Blobs do índice do projeto (HEAD com a árvore limpa).
 * @param {string} dir
 * @returns {Map<string, string>}
 */
export function projectBlobs(dir) {
  const blobs = new Map()
  for (const line of splitZ(git(dir, ['ls-files', '-s', '-z']))) {
    const tab = line.indexOf('\t')
    const [mode, sha] = line.slice(0, tab).split(' ')
    if (mode !== '160000') blobs.set(line.slice(tab + 1), sha)
  }
  return blobs
}

/**
 * @param {string} repo
 * @param {string} sha
 * @returns {Buffer}
 */
export const readBlob = (repo, sha) => git(repo, ['cat-file', 'blob', sha])

/**
 * Renomes do template entre base e alvo: caminho novo → caminho velho.
 * @param {string} repo
 * @param {string} base
 * @param {string} target
 * @returns {Map<string, string>}
 */
export function renames(repo, base, target) {
  const parts = splitZ(git(repo, ['diff', '-M', '--name-status', '-z', base, target]))
  const map = new Map()
  const deleted = []
  const added = []
  for (let i = 0; i < parts.length;) {
    const status = parts[i]
    if (status.startsWith('R') || status.startsWith('C')) {
      if (status.startsWith('R')) map.set(parts[i + 2], parts[i + 1])
      i += 3
    } else {
      if (status === 'D') deleted.push(parts[i + 1])
      if (status === 'A') added.push(parts[i + 1])
      i += 2
    }
  }
  for (const [to, from] of pairByFileName(deleted, added)) map.set(to, from)
  return map
}

const fileName = (/** @type {string} */ path) => path.slice(path.lastIndexOf('/') + 1)

/**
 * Renome que o `-M` não vê (arquivo muito editado ao mudar de pasta): apagado e novo com o
 * mesmo nome de arquivo, único de cada lado.
 * @param {string[]} deleted
 * @param {string[]} added
 * @returns {[string, string][]} pares [novo, velho]
 */
function pairByFileName(deleted, added) {
  /** @param {string[]} paths */
  const uniqueByName = (paths) => {
    const count = new Map()
    for (const path of paths) count.set(fileName(path), (count.get(fileName(path)) ?? 0) + 1)
    return new Map(paths.filter((p) => count.get(fileName(p)) === 1).map((p) => [fileName(p), p]))
  }
  const from = uniqueByName(deleted)
  return [...uniqueByName(added)].flatMap(([name, to]) => {
    const old = from.get(name)
    return old ? [[to, old]] : []
  })
}

/** @param {string} dir */
export const isClean = (dir) => git(dir, ['status', '--porcelain']).toString().trim() === ''

/**
 * Manifesto de uma revisão do template; ausente → null.
 * @param {string} repo
 * @param {string} rev
 */
export function readManifestAt(repo, rev) {
  let raw
  try {
    raw = git(repo, ['show', `${rev}:${MANIFEST_PATH}`]).toString('utf8')
  } catch {
    return null
  }
  try {
    return parseManifest(JSON.parse(raw))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Manifesto inválido em ${rev}: não é JSON.`)
    throw error
  }
}

/**
 * Commit de uma revisão (tag anotada → commit).
 * @param {string} repo
 * @param {string} rev
 */
export const resolveCommit = (repo, rev) =>
  git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])
    .toString()
    .trim()
