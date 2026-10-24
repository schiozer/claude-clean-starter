// Avaliador do hook protect-main: decide se um comando shell traz mudanças para uma branch
// protegida sem PR (regras B1–B9 da spec). Função pura: o conhecimento do git vem por `ctx`.

import { isAbsolute, resolve } from 'node:path'
import { parseCommand } from './parse.mjs'

/**
 * @typedef {object} EvalContext
 * @property {string} cwd Diretório de trabalho do comando.
 * @property {string[]} protectedBranches Branches que só recebem mudanças via PR.
 * @property {(dir: string) => string | null} branchOf Branch atual em `dir` (null = HEAD destacado / fora de repo).
 * @property {(dir: string, name: string) => string | null} aliasOf Expansão de `alias.<name>` em `dir`.
 */

/** @typedef {{ allowed: true } | { allowed: false, reason: string }} Verdict */

/**
 * Estado assumido de um diretório/branch: `UNKNOWN` quando não dá para determinar
 * (`cd $X`, `git checkout <caminho-ou-branch>`) — regras dependentes de branch falham fechadas.
 */
const UNKNOWN = Symbol('unknown')

export const BLOCK_PREFIX =
  'Bloqueado: a `main` só recebe mudanças via PR (CLAUDE.md regra 0, ADR-005). Crie uma branch `tipo/descrição`, faça push e abra o PR; o merge é do humano.'

const AMBIGUOUS =
  'Não foi possível verificar o comando; escreva o comando por extenso (sem variáveis, `eval` ou alias com `!`).'

const NATIVE_GIT = new Set(
  (
    'add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore ' +
    'checkout cherry cherry-pick citool clean clone commit commit-graph commit-tree config ' +
    'count-objects describe diff diff-files diff-index diff-tree difftool fast-export fast-import ' +
    'fetch filter-branch for-each-ref format-patch fsck gc grep gui hash-object help init ' +
    'interpret-trailers log ls-files ls-remote ls-tree maintenance merge merge-base merge-file ' +
    'merge-tree mergetool mktag mktree mv name-rev notes prune pull push range-diff read-tree ' +
    'rebase reflog remote repack replace request-pull reset restore rev-list rev-parse revert rm ' +
    'shortlog show show-branch show-ref sparse-checkout stash status submodule switch ' +
    'symbolic-ref tag update-index update-ref var verify-commit verify-tag version whatchanged ' +
    'worktree write-tree'
  ).split(' ')
)
const WRITE_FAMILY = new Set([
  'commit',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'am',
  'apply',
  'pull',
  'push',
  'switch',
  'checkout',
])
const EXIT_FLAGS = new Set(['--abort', '--quit', '--skip'])
const GLOBAL_OPTIONS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
const MAX_ALIAS_DEPTH = 5

/** Opções (com valor separado) por subcomando, para achar os argumentos posicionais. */
const OPTIONS_WITH_ARG = {
  merge: ['-m', '-F', '--file', '-s', '--strategy', '-X', '--strategy-option', '--into-name'],
  rebase: ['--onto', '-s', '--strategy', '-X', '--strategy-option', '-x', '--exec'],
  pull: ['-s', '--strategy', '-X', '--strategy-option', '--depth', '--deepen', '-o'],
  push: ['--repo', '-o', '--push-option', '--receive-pack', '--exec'],
  switch: ['-c', '-C', '--create', '--force-create', '--orphan'],
  checkout: ['-b', '-B', '--orphan'],
  ghApi: ['-X', '--method', '-H', '--header', '-f', '--raw-field', '-F', '--field', '--input'],
  gh: ['-R', '--repo'],
}

const block = (motive) => `${BLOCK_PREFIX} ${motive}`
const isDynamic = (token) => token.includes('$') || token.includes('`')
const baseName = (token) => token.split('/').pop() ?? ''

/** Argumentos posicionais (sem opções nem seus valores). Para em `--`. */
function positionals(args, optionsWithArg = []) {
  const result = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a === '--') break
    if (optionsWithArg.includes(a)) k++
    else if (!a.startsWith('-') || a === '-') result.push(a)
  }
  return result
}

/**
 * Regra que só vale numa branch protegida.
 * @param {string | null | typeof UNKNOWN} branch
 */
function onProtected(branch, protectedBranches, motive) {
  if (branch === UNKNOWN) return block(AMBIGUOUS)
  return branch !== null && protectedBranches.includes(branch) ? block(motive) : null
}

/** `<remote>/<branch>` (ou `refs/remotes/<remote>/<branch>`) da própria branch atual? */
function isRemoteOfSame(ref, branch) {
  if (typeof branch !== 'string') return false
  const short = ref.replace(/^refs\/remotes\//, '')
  const slash = short.indexOf('/')
  return slash > 0 && short.slice(slash + 1) === branch
}

/** B1: `git commit` numa branch protegida. */
function checkCommit(branch, protectedBranches) {
  return onProtected(branch, protectedBranches, `\`git commit\` na branch \`${String(branch)}\`.`)
}

/** B2–B4: merge, rebase, cherry-pick, revert, am, apply, pull. */
function checkIntegrate(sub, args, branch, protectedBranches) {
  if (args.some((a) => EXIT_FLAGS.has(a))) return null
  const motive = `\`git ${sub}\` na branch \`${String(branch)}\`.`
  const refs = positionals(args, OPTIONS_WITH_ARG[sub])
  const continuing = args.includes('--continue')
  switch (sub) {
    case 'apply': {
      const touchesIndex = args.some((a) => ['--index', '--cached', '-3', '--3way'].includes(a))
      return touchesIndex ? onProtected(branch, protectedBranches, motive) : null
    }
    case 'merge':
      if (!continuing && refs.length && refs.every((r) => isRemoteOfSame(r, branch))) return null
      return onProtected(branch, protectedBranches, motive)
    case 'rebase': {
      const pullLike =
        !continuing &&
        !args.includes('--onto') &&
        refs.length === 1 &&
        isRemoteOfSame(refs[0], branch)
      return pullLike ? null : onProtected(branch, protectedBranches, motive)
    }
    case 'pull': {
      const sources = refs.slice(1).map((r) => r.replace(/^\+/, '').split(':')[0])
      const others = sources.filter((s) => s.replace(/^refs\/heads\//, '') !== branch)
      return others.length ? onProtected(branch, protectedBranches, motive) : null
    }
    default:
      return onProtected(branch, protectedBranches, motive)
  }
}

/** Branch de destino de um refspec de push (`HEAD` = branch atual). */
function pushDestination(refspec, branch) {
  const spec = refspec.replace(/^\+/, '')
  const dest = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec
  const name = dest.replace(/^refs\/heads\//, '')
  return name === 'HEAD' ? branch : name
}

/** B5–B7: `git push`. */
function checkPush(args, branch, protectedBranches) {
  if (args.some((a) => ['--all', '--mirror', '--branches'].includes(a))) {
    return block('`git push --all`/`--mirror` envia todas as branches, inclusive as protegidas.')
  }
  const refspecs = positionals(args, OPTIONS_WITH_ARG.push).slice(1)
  if (!refspecs.length) {
    return onProtected(branch, protectedBranches, `\`git push\` na branch \`${String(branch)}\`.`)
  }
  for (const refspec of refspecs) {
    const dest = pushDestination(refspec, branch)
    if (dest === UNKNOWN) return block(AMBIGUOUS)
    if (dest !== null && protectedBranches.includes(dest)) {
      return block(`\`git push\` com destino na branch protegida \`${dest}\`.`)
    }
  }
  return null
}

/** B8–B9: `gh pr merge` e `gh api …/merge(s)`. Em segmento ambíguo, falha fechado. */
function checkGh(args, ambiguous) {
  const [group, action] = positionals(args, [...OPTIONS_WITH_ARG.gh, ...OPTIONS_WITH_ARG.ghApi])
  if (ambiguous && (isDynamic(group ?? '') || isDynamic(action ?? '') || group === 'api')) {
    return block(AMBIGUOUS)
  }
  if (group === 'pr' && action === 'merge') return block('`gh pr merge` é feito pelo humano.')
  const endpoint = (action ?? '').split('?')[0]
  if (group === 'api' && /\/merges?\/?$/.test(endpoint)) {
    return block('`gh api` de merge é feito pelo humano.')
  }
  return null
}

/** Separa opções globais do git do subcomando. */
function splitGitArgv(argv) {
  let k = 1
  /** @type {string | null} */
  let chdir = null
  let otherRepo = false
  for (; k < argv.length; k++) {
    const a = argv[k]
    if (!a.startsWith('-')) break
    const name = a.split('=')[0]
    if (name === '--git-dir' || name === '--work-tree') otherRepo = true
    if (a === '-C') chdir = argv[k + 1] ?? null
    if (GLOBAL_OPTIONS_WITH_ARG.has(a)) k++
  }
  return { globals: argv.slice(1, k), sub: argv[k], args: argv.slice(k + 1), chdir, otherRepo }
}

/**
 * Branch assumida após `git switch`/`git checkout` (`undefined` = não muda).
 * `git checkout <x>` sem `-b` pode ser caminho ou branch: só é confiável se `<x>` é protegida.
 */
function branchAfterSwitch(sub, args, protectedBranches) {
  const createFlags = OPTIONS_WITH_ARG[sub]
  const created = args.findIndex((a) => createFlags.includes(a) && a !== '--orphan')
  if (created !== -1) return args[created + 1] ?? UNKNOWN
  if (args.includes('--detach') || args.includes('-d')) return null
  if (sub === 'checkout' && args.includes('--')) return undefined
  const [target] = positionals(args, createFlags)
  if (target === undefined) return undefined
  if (target === '-') return UNKNOWN
  if (sub === 'checkout' && !protectedBranches.includes(target)) return UNKNOWN
  return target
}

/**
 * Avalia um segmento `git …`. Devolve o motivo do bloqueio (ou null) e a branch assumida
 * depois dele (`undefined` = não muda).
 */
function evaluateGit(argv, ambiguous, state, ctx, depth = 0) {
  const { globals, sub, args, chdir, otherRepo } = splitGitArgv(argv)
  if (sub === undefined) return { reason: null }
  if (isDynamic(sub)) return { reason: block(AMBIGUOUS) }

  if (!NATIVE_GIT.has(sub)) {
    const expansion = ctx.aliasOf(state.dir === UNKNOWN ? ctx.cwd : state.dir, sub)
    if (expansion === null) return { reason: null }
    if (expansion.trim().startsWith('!') || depth >= MAX_ALIAS_DEPTH) {
      return { reason: block(AMBIGUOUS) }
    }
    const expanded = parseCommand(expansion)[0]?.argv ?? []
    return evaluateGit(['git', ...globals, ...expanded, ...args], ambiguous, state, ctx, depth + 1)
  }

  if (ambiguous && WRITE_FAMILY.has(sub)) return { reason: block(AMBIGUOUS) }

  let branch = state.branch
  if (otherRepo) branch = UNKNOWN
  else if (chdir !== null) branch = branchIn(resolveDir(state.dir, chdir), ctx)
  const { protectedBranches } = ctx

  if (sub === 'commit') return { reason: checkCommit(branch, protectedBranches) }
  if (sub === 'push') return { reason: checkPush(args, branch, protectedBranches) }
  if (WRITE_FAMILY.has(sub) && sub !== 'switch' && sub !== 'checkout') {
    return { reason: checkIntegrate(sub, args, branch, protectedBranches) }
  }
  if ((sub === 'switch' || sub === 'checkout') && chdir === null && !otherRepo) {
    return { reason: null, branch: branchAfterSwitch(sub, args, protectedBranches) }
  }
  return { reason: null }
}

/** Diretório após `cd <target>` (relativo ao anterior). */
function resolveDir(dir, target) {
  if (target === undefined || isDynamic(target) || /^[~-]/.test(target)) return UNKNOWN
  if (isAbsolute(target)) return resolve(target)
  return dir === UNKNOWN ? UNKNOWN : resolve(dir, target)
}

function branchIn(dir, ctx) {
  return dir === UNKNOWN ? UNKNOWN : ctx.branchOf(dir)
}

/**
 * @param {string} command
 * @param {EvalContext} ctx
 * @returns {Verdict}
 */
export function evaluateCommand(command, ctx) {
  const state = { dir: resolve(ctx.cwd), branch: ctx.branchOf(resolve(ctx.cwd)) }
  for (const { argv, ambiguous } of parseCommand(command)) {
    const program = baseName(argv[0])
    let reason = null
    if (program === 'cd' || program === 'pushd') {
      state.dir = resolveDir(state.dir, argv[1])
      state.branch = branchIn(state.dir, ctx)
    } else if (program === 'popd') {
      state.dir = UNKNOWN
      state.branch = UNKNOWN
    } else if (program === 'eval') {
      reason = /\bgit\b|\bgh\b/.test(argv.join(' ')) ? block(AMBIGUOUS) : null
    } else if (program === 'git') {
      const result = evaluateGit(argv, ambiguous, state, ctx)
      reason = result.reason
      if (result.branch !== undefined) state.branch = result.branch
    } else if (program === 'gh') {
      reason = checkGh(argv.slice(1), ambiguous)
    } else if (ambiguous && isDynamic(argv[0]) && /\bgit\b|\bgh\b/i.test(argv[0])) {
      reason = block(AMBIGUOUS)
    }
    if (reason !== null) return { allowed: false, reason }
  }
  return { allowed: true }
}
