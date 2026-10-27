// Classificação de três vias do template sync (spec 2026-10-27-template-sync-design.md §5.2).

/**
 * @typedef {'owned' | 'unchanged-template' | 'in-sync' | 'template-only' | 'both-changed' | 'add-add' | 'deleted-modified' | 'modified-deleted'} Case
 * @typedef {'none' | 'write' | 'delete' | 'move' | 'merge' | 'ask'} Action
 * @typedef {{ path: string, case: Case, action: Action, from?: string, base: string | null, target: string | null, project: string | null }} PlanEntry
 */

/**
 * @param {{ base: string | null, target: string | null, project: string | null, owned: boolean }} e
 * @returns {{ case: Case, action: Action }}
 */
export function classifyEntry({ base, target, project, owned }) {
  if (owned) return { case: 'owned', action: 'none' }
  if (target === base) return { case: 'unchanged-template', action: 'none' }
  if (project === target) return { case: 'in-sync', action: 'none' }
  if (project === base) {
    return { case: 'template-only', action: target === null ? 'delete' : 'write' }
  }
  if (base === null) return { case: 'add-add', action: 'ask' }
  if (target === null) return { case: 'deleted-modified', action: 'ask' }
  if (project === null) return { case: 'modified-deleted', action: 'ask' }
  return { case: 'both-changed', action: 'merge' }
}

/**
 * Renome do template: o arquivo velho do projeto vai para o caminho novo.
 * @param {string | null} base
 * @param {string | null} target
 * @param {string} projectOld
 * @returns {{ case: Case, action: Action }}
 */
function classifyRename(base, target, projectOld) {
  if (projectOld === base || projectOld === target) return { case: 'template-only', action: 'move' }
  return { case: 'both-changed', action: 'merge' }
}

/**
 * @param {{
 *   base: Map<string, string>, target: Map<string, string>, project: Map<string, string>,
 *   renames: Map<string, string>, isManaged: (p: string) => boolean, projectOwned: string[]
 * }} input
 * @returns {PlanEntry[]}
 */
export function buildPlan({ base, target, project, renames, isManaged, projectOwned }) {
  const owned = new Set(projectOwned)
  const renamedFrom = new Set(renames.values())
  const paths = new Set([...base.keys(), ...target.keys()].filter(isManaged))
  /** @type {PlanEntry[]} */
  const entries = []

  for (const path of paths) {
    const from = renames.get(path)
    if (from !== undefined) {
      const b = base.get(from) ?? null
      const t = target.get(path) ?? null
      const pOld = project.get(from)
      if (pOld !== undefined && !project.has(path) && !owned.has(path) && !owned.has(from)) {
        entries.push({
          path,
          from,
          ...classifyRename(b, t, pOld),
          base: b,
          target: t,
          project: pOld,
        })
        continue
      }
      const p = project.get(path) ?? null
      entries.push({
        path,
        ...classifyEntry({ base: b, target: t, project: p, owned: owned.has(path) }),
        base: b,
        target: t,
        project: p,
      })
      continue
    }
    if (renamedFrom.has(path) && !target.has(path)) continue
    const b = base.get(path) ?? null
    const t = target.get(path) ?? null
    const p = project.get(path) ?? null
    entries.push({
      path,
      ...classifyEntry({ base: b, target: t, project: p, owned: owned.has(path) }),
      base: b,
      target: t,
      project: p,
    })
  }
  return entries.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
}
