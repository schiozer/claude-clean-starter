// Matéria-prima do modo `status` (spec 2026-10-27-template-sync-design.md §5.6): versão, atraso,
// divergências e o que o projeto tem de próprio. Quem julga repetições entre projetos é a skill.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readControl } from './control.mjs'
import { projectBlobs, readManifestAt, treeBlobs } from './git.mjs'
import { makeMatcher } from './manifest.mjs'
import { latestRelease, releasesAfter } from './versions.mjs'

const OWN_ADR = /^docs\/adr\/[^/]+\.md$/
const OWN_DIRS =
  /^(scripts|\.github\/workflows|\.claude\/skills|\.claude\/commands|hooks|docs\/guides|docs\/runbooks)\//

/**
 * @param {{ templateDir: string, projectDir: string }} input
 */
export function inventory({ templateDir, projectDir }) {
  const control = readControl(projectDir)
  const latest = latestRelease(templateDir)
  const rev = latest?.commit ?? 'HEAD'
  const target = treeBlobs(templateDir, rev)
  const manifest = readManifestAt(templateDir, rev)
  const isManaged = manifest ? makeMatcher(manifest) : () => false
  const project = projectBlobs(projectDir)
  const owned = new Set(control?.projectOwned ?? [])

  const divergent = [...target.keys()]
    .filter((p) => isManaged(p) && !owned.has(p) && project.get(p) !== target.get(p))
    .sort()
  const own = [...project.keys()].filter((p) => !target.has(p)).sort()
  const adrTitles = own
    .filter((p) => OWN_ADR.test(p))
    .map((p) =>
      readFileSync(join(projectDir, p), 'utf8')
        .match(/^# (.+)$/m)?.[1]
        ?.trim()
    )
    .filter((t) => t !== undefined)

  return {
    project: projectDir,
    lastSync: control?.lastSync ?? null,
    behind: control ? releasesAfter(templateDir, control.lastSync).length : null,
    divergent,
    own: { adrTitles, files: own.filter((p) => OWN_DIRS.test(p)) },
  }
}

/**
 * Termos proibidos (contas, repos, projetos) num texto; case-insensitive.
 * @param {string} text
 * @param {string[]} terms
 * @returns {{ term: string, line: number }[]}
 */
export function findForbidden(text, terms) {
  const found = []
  const lines = text.split('\n')
  for (const term of terms.filter((t) => t.trim() !== '')) {
    const needle = term.toLowerCase()
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(needle)) found.push({ term, line: i + 1 })
    })
  }
  return found
}
