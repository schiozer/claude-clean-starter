// Releases do template e proposta de base na adoção (spec 2026-10-27-template-sync-design.md §3.C, §5.7).

import { git, projectBlobs, treeBlobs } from './git.mjs'

const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/
const EXAMPLES = /^examples\//

/** @param {string} tag */
const semver = (tag) =>
  /** @type {RegExpMatchArray} */ (tag.match(VERSION_TAG)).slice(1).map(Number)

/** @param {string} a @param {string} b */
function compareTags(a, b) {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** @param {string} templateDir */
function releaseTags(templateDir) {
  return git(templateDir, ['tag', '--list', 'v*'])
    .toString('utf8')
    .split('\n')
    .filter((t) => VERSION_TAG.test(t))
    .sort(compareTags)
}

/** @param {string} templateDir @param {string} tag */
const commitOfTag = (templateDir, tag) =>
  git(templateDir, ['rev-list', '-n', '1', tag]).toString('utf8').trim()

/**
 * @param {string} templateDir
 * @returns {{ tag: string, commit: string } | null}
 */
export function latestRelease(templateDir) {
  const tag = releaseTags(templateDir).at(-1)
  return tag ? { tag, commit: commitOfTag(templateDir, tag) } : null
}

/** @param {string} repo @param {string} ancestor @param {string} commit */
function isAncestor(repo, ancestor, commit) {
  try {
    git(repo, ['merge-base', '--is-ancestor', ancestor, commit])
    return true
  } catch {
    return false
  }
}

/**
 * Releases (ordem crescente) depois do `lastSync`; funciona com `version: null`.
 * @param {string} templateDir
 * @param {import('./control.mjs').LastSync} lastSync
 * @returns {string[]}
 */
export function releasesAfter(templateDir, lastSync) {
  return releaseTags(templateDir).filter((tag) => {
    const commit = commitOfTag(templateDir, tag)
    return commit !== lastSync.commit && isAncestor(templateDir, lastSync.commit, commit)
  })
}

/**
 * Top 3 commits do template com mais arquivos idênticos ao projeto (fora de `examples/`).
 * @param {string} templateDir
 * @param {string} projectDir
 * @param {string} [rev]
 * @returns {{ commit: string, date: string, identical: number, total: number }[]}
 */
export function proposeBase(templateDir, projectDir, rev = 'HEAD') {
  const project = projectBlobs(projectDir)
  const commits = git(templateDir, ['rev-list', '--format=%H %cs', '--no-commit-header', rev])
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(' '))
  const ranked = commits.map(([commit, date], order) => {
    let identical = 0
    let total = 0
    for (const [path, sha] of treeBlobs(templateDir, commit)) {
      if (EXAMPLES.test(path)) continue
      total += 1
      if (project.get(path) === sha) identical += 1
    }
    return { commit, date, identical, total, order }
  })
  // rev-list vem do mais novo para o mais velho: empate → menor `order` (mais novo).
  ranked.sort((a, b) => b.identical - a.identical || a.order - b.order)
  return ranked
    .slice(0, 3)
    .map(({ commit, date, identical, total }) => ({ commit, date, identical, total }))
}
