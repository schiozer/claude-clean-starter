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
 * @property {Record<string, string | undefined>} [env] `HOME` e `CLAUDE_PROJECT_DIR`, para resolver
 *   `cd ~`, `cd "$HOME/x"` e `cd "$CLAUDE_PROJECT_DIR"`.
 */

/** @typedef {import('./parse.mjs').Segment} Segment */

/** @typedef {{ allowed: true } | { allowed: false, reason: string }} Verdict */

/**
 * Estado assumido de um diretório/branch: `UNKNOWN` quando não dá para determinar
 * (`cd $X`, `git checkout <caminho-ou-branch>`) — regras dependentes de branch falham fechadas.
 */
const UNKNOWN = Symbol('unknown')

export const BLOCK_PREFIX =
  'Bloqueado: a `main` só recebe mudanças via PR (CLAUDE.md regra 0, ADR-005). Crie uma branch `tipo/descrição`, faça push e abra o PR; o merge é do humano.'

/** O texto menciona git/gh? Mesmo critério do fail-closed do `run.mjs`. */
export const MENTIONS_GIT = /\bgit\b|\bgh\b/i

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
const GLOBAL_OPTIONS_WITH_ARG = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
])
/** Config que muda o destino de um `git push` sem refspec explícito. */
const PUSH_CONFIG = /^(push\.default|remote\..+\.(push|mirror))$/i
const GRAPHQL_WRITE =
  /mergePullRequest|enablePullRequestAutoMerge|updateRef|createCommitOnBranch|mergeBranch/i
const GH_API_FIELDS = ['-f', '--raw-field', '-F', '--field', '--input']
const MAX_ALIAS_DEPTH = 5
const DECLARATIONS = new Set(['export', 'declare', 'typeset', 'local', 'readonly'])

/** Opções (com valor separado) por subcomando, para achar os argumentos posicionais. */
const OPTIONS_WITH_ARG = {
  merge: ['-m', '-F', '--file', '-s', '--strategy', '-X', '--strategy-option', '--into-name'],
  rebase: ['--onto', '-s', '--strategy', '-X', '--strategy-option', '-x', '--exec'],
  pull: ['-s', '--strategy', '-X', '--strategy-option', '--depth', '--deepen', '-o'],
  push: ['--repo', '-o', '--push-option', '--receive-pack', '--exec'],
  switch: ['-c', '-C', '--create', '--force-create', '--orphan'],
  checkout: ['-b', '-B', '--orphan'],
  ghApi: [
    '-X',
    '--method',
    '-H',
    '--header',
    ...GH_API_FIELDS,
    '-q',
    '--jq',
    '-t',
    '--template',
    '-p',
    '--preview',
    '--hostname',
    '--cache',
  ],
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

/** Refspec `:`/`+:` — push "matching" de todas as branches com o mesmo nome no remoto. */
const MATCHING = Symbol('matching')

/** Branch de destino de um refspec de push (`HEAD` = branch atual). */
function pushDestination(refspec, branch) {
  const spec = refspec.replace(/^\+/, '')
  const dest = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec
  if (spec.includes(':') && dest === '') return MATCHING
  const name = dest.replace(/^(refs\/)?heads\//, '')
  return name === 'HEAD' || name === '@' ? branch : name
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
    if (dest === MATCHING) {
      return block(
        '`git push <remoto> :` (matching) envia todas as branches, inclusive as protegidas.'
      )
    }
    if (dest !== null && dest.includes('*')) {
      return block(
        '`git push` com refspec glob (`*`) envia várias branches, inclusive as protegidas.'
      )
    }
    if (dest !== null && protectedBranches.includes(dest)) {
      return block(`\`git push\` com destino na branch protegida \`${dest}\`.`)
    }
  }
  return null
}

/** Valor de uma opção `gh` (`-X PUT`, `-XPUT`, `--method=PUT`). */
function optionValues(args, names) {
  const values = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (names.includes(a)) values.push(args[++k] ?? '')
    else {
      const long = names.find((n) => n.startsWith('--') && a.startsWith(`${n}=`))
      const short = names.find((n) => !n.startsWith('--') && a.length > 2 && a.startsWith(n))
      if (long) values.push(a.slice(long.length + 1))
      else if (short) values.push(a.slice(short.length))
    }
  }
  return values
}

/**
 * `gh api`: merge (B9), mutação GraphQL de merge/ref e escrita REST em ref ou conteúdo da
 * branch protegida.
 */
function checkGhApi(args, endpoint, protectedBranches) {
  if (/\/merges?\/?$/.test(endpoint)) return block('`gh api` de merge é feito pelo humano.')
  const fields = optionValues(args, GH_API_FIELDS)
  if (endpoint === 'graphql') {
    return fields.some((f) => GRAPHQL_WRITE.test(f))
      ? block('`gh api graphql` com mutação de merge/ref é feito pelo humano.')
      : null
  }
  const method = optionValues(args, ['-X', '--method']).pop() ?? (fields.length ? 'POST' : 'GET')
  if (method.toUpperCase() === 'GET') return null
  const ref = /(?:^|\/)git\/refs\/heads\/(.+?)\/?$/.exec(endpoint)?.[1]
  const createsRef =
    /(?:^|\/)git\/refs\/?$/.test(endpoint) &&
    fields.some((f) => protectedBranches.some((b) => f === `ref=refs/heads/${b}`))
  if ((ref !== undefined && protectedBranches.includes(ref)) || createsRef) {
    return block('`gh api` escrevendo direto na ref de uma branch protegida.')
  }
  if (/(?:^|\/)contents\//.test(endpoint)) {
    return block('`gh api …/contents/` grava commits direto na branch.')
  }
  return null
}

/** B8–B9: `gh pr merge`, `gh api` e `gh alias set` de merge. Em segmento ambíguo, falha fechado. */
function checkGh(args, segment, protectedBranches) {
  if (segment.opaqueArgs) return block(AMBIGUOUS)
  const [group, action, ...rest] = positionals(args, [
    ...OPTIONS_WITH_ARG.gh,
    ...OPTIONS_WITH_ARG.ghApi,
  ])
  if (segment.ambiguous && (isDynamic(group ?? '') || isDynamic(action ?? '') || group === 'api')) {
    return block(AMBIGUOUS)
  }
  if (group === 'pr' && action === 'merge') return block('`gh pr merge` é feito pelo humano.')
  if (group === 'alias' && action === 'set' && /merge/i.test(rest.slice(1).join(' '))) {
    return block('`gh alias` de merge: o merge é feito pelo humano.')
  }
  if (group === 'api') return checkGhApi(args, (action ?? '').split('?')[0], protectedBranches)
  return null
}

/** Separa opções globais do git do subcomando; `configs` são os `-c k=v`. */
function splitGitArgv(argv) {
  let k = 1
  /** @type {string | null} */
  let chdir = null
  let otherRepo = false
  let configEnv = false
  /** @type {string[]} */
  const configs = []
  for (; k < argv.length; k++) {
    const a = argv[k]
    if (!a.startsWith('-')) break
    const name = a.split('=')[0]
    if (name === '--git-dir' || name === '--work-tree') otherRepo = true
    if (name === '--config-env') configEnv = true
    if (a === '-C') chdir = argv[k + 1] ?? null
    if (a === '-c') configs.push(argv[k + 1] ?? '')
    if (GLOBAL_OPTIONS_WITH_ARG.has(a)) k++
  }
  const globals = argv.slice(1, k)
  return { globals, sub: argv[k], args: argv.slice(k + 1), chdir, otherRepo, configEnv, configs }
}

/** Valor do último `-c <key>=<v>` (chave sem diferenciar maiúsculas), ou undefined. */
function configValue(configs, key) {
  const pair = configs.findLast((c) => c.split('=')[0].toLowerCase() === key.toLowerCase())
  return pair === undefined ? undefined : pair.slice(pair.indexOf('=') + 1)
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
 * Avalia um segmento `git …` e devolve o motivo do bloqueio (ou null).
 * `switch`/`checkout` registram a nova branch em `state.switches`.
 */
function evaluateGit(argv, segment, state, ctx, depth = 0) {
  // `xargs git …`: subcomando e argumentos podem vir da entrada.
  if (segment.opaqueArgs) return block(AMBIGUOUS)
  const { globals, sub, args, chdir, otherRepo, configEnv, configs } = splitGitArgv(argv)
  if (sub === undefined) return null
  if (isDynamic(sub)) return block(AMBIGUOUS)
  // Repositório ou config definidos fora do comando (`GIT_DIR`, `GIT_CONFIG_*`, `--config-env`…).
  const foreign = otherRepo || configEnv || segment.gitEnv || state.gitEnv

  if (!NATIVE_GIT.has(sub)) {
    const inline = configValue(configs, `alias.${sub}`)
    if (inline === undefined && foreign) return block(AMBIGUOUS)
    const expansion = inline ?? ctx.aliasOf(state.dir === UNKNOWN ? ctx.cwd : state.dir, sub)
    if (expansion === null) return null
    if (expansion.trim().startsWith('!') || depth >= MAX_ALIAS_DEPTH) {
      return block(AMBIGUOUS)
    }
    const expanded = parseCommand(expansion)[0]?.argv ?? []
    return evaluateGit(['git', ...globals, ...expanded, ...args], segment, state, ctx, depth + 1)
  }

  if (segment.ambiguous && WRITE_FAMILY.has(sub)) return block(AMBIGUOUS)
  if (sub === 'push' && configs.some((c) => PUSH_CONFIG.test(c.split('=')[0]))) {
    return block('`git -c push.default`/`remote.<r>.push` muda o destino do `git push`.')
  }

  const dir = foreign ? UNKNOWN : chdir === null ? state.dir : resolveDir(state.dir, chdir, ctx.env)
  const branch = branchAt(dir, state, ctx)
  const { protectedBranches } = ctx

  if (sub === 'commit') return checkCommit(branch, protectedBranches)
  if (sub === 'push') return checkPush(args, branch, protectedBranches)
  if (WRITE_FAMILY.has(sub) && sub !== 'switch' && sub !== 'checkout') {
    return checkIntegrate(sub, args, branch, protectedBranches)
  }
  if (sub === 'switch' || sub === 'checkout') {
    const next = branchAfterSwitch(sub, args, protectedBranches)
    if (next !== undefined) recordSwitch(dir, next, state, ctx)
  }
  return null
}

const HOME_PREFIX = /^(~|\$HOME|\$\{HOME\}|\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR\})(?=\/|$)/

/** Troca `~`, `$HOME` e `$CLAUDE_PROJECT_DIR` no início pelo valor de `env` (se houver). */
function expandHome(target, env = {}) {
  const prefix = HOME_PREFIX.exec(target)?.[1]
  if (prefix === undefined) return target
  const value = env[prefix === '~' ? 'HOME' : prefix.replace(/[${}]/g, '')]
  return value ? value + target.slice(prefix.length) : target
}

/** Diretório após `cd <target>` (relativo ao anterior). */
function resolveDir(dir, rawTarget, env) {
  const target = rawTarget === undefined ? undefined : expandHome(rawTarget, env)
  if (target === undefined || isDynamic(target) || /^[~-]/.test(target)) return UNKNOWN
  if (isAbsolute(target)) return resolve(target)
  return dir === UNKNOWN ? UNKNOWN : resolve(dir, target)
}

/** `a` e `b` são o mesmo diretório, ou um contém o outro? */
const related = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)

/**
 * Branch assumida em `dir`, considerando os `switch`/`checkout` já feitos no comando.
 * Uma troca vale para diretórios relacionados (pai/filho) do mesmo worktree — identificado
 * pela branch original igual (o git não deixa dois worktrees na mesma branch).
 */
function branchAt(dir, state, ctx) {
  if (dir === UNKNOWN) return UNKNOWN
  const original = ctx.branchOf(dir)
  let branch = original
  for (const [switchedDir, entry] of state.switches) {
    if (switchedDir === UNKNOWN) {
      branch = UNKNOWN
    } else if (related(dir, switchedDir) && entry.original === original) {
      branch = entry.branch
    }
  }
  return branch
}

/** Registra a troca de branch feita em `dir` (a mais recente fica por último no Map). */
function recordSwitch(dir, branch, state, ctx) {
  const original = dir === UNKNOWN ? UNKNOWN : ctx.branchOf(dir)
  state.switches.delete(dir)
  state.switches.set(dir, { original, branch })
}

/** Avalia `argv` se o programa é git ou gh. */
function evaluateProgram(argv, segment, state, ctx) {
  const program = baseName(argv[0])
  if (program === 'git') return evaluateGit(argv, segment, state, ctx)
  if (program === 'gh') return checkGh(argv.slice(1), segment, ctx.protectedBranches)
  return null
}

/** Avalia um segmento; `cd` atualiza `state.dir` (só fora de pipeline/background). */
function evaluateSegment(segment, command, state, ctx) {
  const { argv } = segment
  // `GIT_DIR=x` isolado ou `export GIT_DIR=x` vale para os segmentos seguintes.
  if (segment.gitEnv && (!argv.length || DECLARATIONS.has(argv[0]))) state.gitEnv = true
  if (!argv.length) return null
  if (segment.stdinScript) return MENTIONS_GIT.test(command) ? block(AMBIGUOUS) : null
  const program = baseName(argv[0])
  if (program === 'cd' || program === 'pushd' || program === 'popd') {
    if (segment.pipeline || segment.background) return null
    state.dir = program === 'popd' ? UNKNOWN : resolveDir(state.dir, argv[1], ctx.env)
    return null
  }
  if (program === 'eval') return MENTIONS_GIT.test(argv.join(' ')) ? block(AMBIGUOUS) : null
  if (segment.ambiguous && isDynamic(argv[0])) {
    return MENTIONS_GIT.test(command) ? block(AMBIGUOUS) : null
  }
  const reason = evaluateProgram(argv, segment, state, ctx)
  if (reason !== null || program === 'git' || program === 'gh') return reason
  // Fallback para wrappers desconhecidos: `foo … git push …` também é avaliado.
  for (let k = 1; k < argv.length; k++) {
    if (baseName(argv[k]) !== 'git' && baseName(argv[k]) !== 'gh') continue
    const inner = evaluateProgram(argv.slice(k), segment, state, ctx)
    if (inner !== null) return inner
  }
  return null
}

/**
 * Ajusta a pilha de diretórios ao escopo de subshell do segmento: ao sair de um subshell, o
 * diretório volta ao de antes dele; ao entrar, herda o atual.
 * @param {{ id: string, dir: string | typeof UNKNOWN }[]} stack
 * @param {string[]} scope
 */
function enterScope(stack, scope) {
  let common = 0
  while (common < scope.length && stack[common + 1]?.id === scope[common]) common++
  stack.length = common + 1
  for (const id of scope.slice(common)) stack.push({ id, dir: stack[stack.length - 1].dir })
}

/**
 * @param {string} command
 * @param {EvalContext} ctx
 * @returns {Verdict}
 */
export function evaluateCommand(command, ctx) {
  const root = resolve(ctx.cwd)
  /** @type {{ dir: string | typeof UNKNOWN, switches: Map<unknown, unknown>, gitEnv: boolean }} */
  const state = { dir: root, switches: new Map(), gitEnv: false }
  /** @type {{ id: string, dir: string | typeof UNKNOWN }[]} */
  const stack = [{ id: '', dir: root }]
  for (const segment of parseCommand(command)) {
    enterScope(stack, segment.scope)
    const top = stack[stack.length - 1]
    state.dir = top.dir
    const reason = evaluateSegment(segment, command, state, ctx)
    top.dir = state.dir
    if (reason !== null) return { allowed: false, reason }
  }
  return { allowed: true }
}
