// Parser de comandos shell do hook protect-main.
// A partir dos segmentos crus do scanner, desembrulha wrappers (`env`, `timeout`, `xargs`…),
// shells (`bash -c`, heredoc, here-string) e substituições `$(…)`/backticks, devolvendo os
// segmentos na ordem em que o shell os executaria. Não executa nem expande nada.

import { scan, scanWords } from './scan.mjs'

/**
 * @typedef {object} Segment
 * @property {string[]} argv Tokens já desembrulhados (sem atribuições `VAR=x` nem wrappers).
 * @property {boolean} ambiguous Resultado depende de expansão que não conseguimos resolver.
 * @property {string[]} scope Caminho de subshells (`( … )`, `$(…)`, `bash -c`) em que roda;
 *   um `cd` só vale dentro do próprio escopo.
 * @property {boolean} pipeline Faz parte de um pipeline (`|`): roda num subshell.
 * @property {boolean} background Termina em `&`: roda num subshell.
 * @property {boolean} gitEnv Prefixos mudam o repositório/config do git (`GIT_DIR`,
 *   `GIT_WORK_TREE`, `GIT_CONFIG_*`, `env -C`); atribuição/`export` isolada vem com `argv` vazio.
 * @property {boolean} opaqueArgs Argumentos completados pela entrada (`xargs`).
 * @property {boolean} stdinScript Shell que lê o script de um pipe.
 */

/** @typedef {import('./scan.mjs').Token} Token */
/** @typedef {import('./scan.mjs').RawSegment} RawSegment */

const MESSAGE_FLAGS = new Set(['-m', '--message', '-F', '--file'])
const MESSAGE_FLAG_PREFIXES = ['--message=', '--file=']
const GIT_MESSAGE_SUBCOMMANDS = new Set(['commit', 'merge', 'tag', 'notes', 'stash'])
const SHELL_OPTIONS_WITH_ARG = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
const DECLARATIONS = new Set(['export', 'declare', 'typeset', 'local', 'readonly'])
const KEYWORDS = new Set([
  '{',
  '}',
  '!',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
])

/**
 * Wrappers que executam o comando seguinte: opções que levam valor separado e quantos
 * posicionais vêm antes do comando (`timeout <duração> cmd`).
 * @type {Record<string, { withArg: string[], positionals?: number }>}
 */
const WRAPPERS = {
  env: { withArg: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'] },
  sudo: { withArg: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T'] },
  doas: { withArg: ['-u', '-C'] },
  time: { withArg: ['-f', '--format', '-o', '--output'] },
  command: { withArg: [] },
  exec: { withArg: ['-a'] },
  nohup: { withArg: [] },
  nice: { withArg: ['-n', '--adjustment'] },
  timeout: { withArg: ['-s', '--signal', '-k', '--kill-after'], positionals: 1 },
  stdbuf: { withArg: ['-i', '--input', '-o', '--output', '-e', '--error'] },
  caffeinate: { withArg: ['-w', '-t'] },
  ionice: { withArg: ['-c', '--class', '-n', '--classdata', '-p', '--pid', '-P', '-u'] },
  xargs: {
    withArg: ['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--max-args', '--max-procs'],
  },
}
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const GIT_ENV_ASSIGNMENT = /^GIT_(CONFIG\w*|DIR|WORK_TREE)=/
const REDIRECTION = /^\d*[<>]/

const baseName = (text) => text.split('/').pop() ?? ''

/**
 * Remove wrappers, atribuições e palavras-chave do início.
 * @param {Token[]} tokens
 * @returns {{ tokens: Token[], gitEnv: boolean, opaqueArgs: boolean }}
 */
function stripPrefixes(tokens) {
  let t = tokens
  let gitEnv = false
  let opaqueArgs = false
  for (;;) {
    if (!t.length) return { tokens: t, gitEnv, opaqueArgs }
    const head = t[0].text
    const name = baseName(head)
    if (ASSIGNMENT.test(head)) {
      gitEnv ||= GIT_ENV_ASSIGNMENT.test(head)
      t = t.slice(1)
    } else if (KEYWORDS.has(head)) {
      t = t.slice(1)
    } else if (Object.hasOwn(WRAPPERS, name)) {
      const { withArg, positionals = 0 } = WRAPPERS[name]
      if (name === 'xargs') opaqueArgs = true
      let k = 1
      /** @type {Token[]} */
      let split = []
      while (k < t.length && (t[k].text.startsWith('-') || ASSIGNMENT.test(t[k].text))) {
        const opt = t[k].text
        gitEnv ||= GIT_ENV_ASSIGNMENT.test(opt)
        if (name === 'env' && /^(-C|--chdir)/.test(opt)) gitEnv = true
        if (name === 'env' && /^(-S|--split-string)/.test(opt)) {
          const value = opt.includes('=')
            ? opt.slice(opt.indexOf('=') + 1)
            : opt.length > 2 && opt.startsWith('-S')
              ? opt.slice(2)
              : (t[k + 1]?.text ?? '')
          split = scanWords(value)
        }
        k += withArg.includes(opt) ? 2 : 1
      }
      t = [...split, ...t.slice(k + positionals)]
    } else return { tokens: t, gitEnv, opaqueArgs }
  }
}

/** Há token dinâmico (`$VAR`, `$(…)`, backticks) que não seja valor de `-m`/`--message`/`-F`/`--file`? */
function hasUnresolvedExpansion(tokens, messageFlagsApply) {
  return tokens.some((tok, k) => {
    if (!tok.dynamic) return false
    if (!messageFlagsApply) return true
    if (k > 0 && MESSAGE_FLAGS.has(tokens[k - 1].text)) return false
    return !MESSAGE_FLAG_PREFIXES.some((p) => tok.text.startsWith(p))
  })
}

/** Subcomando do git (pulando opções globais), ou null se o comando não é git. */
function gitSubcommand(tokens) {
  if (baseName(tokens[0].text) !== 'git') return null
  for (let k = 1; k < tokens.length; k++) {
    const t = tokens[k].text
    if (t === '-C' || t === '-c') k++
    else if (!t.startsWith('-')) return t
  }
  return ''
}

/** `-m`/`-F` carregam uma mensagem/arquivo? Em `git checkout -m`/`switch -m` não carregam. */
function messageFlagsApply(tokens) {
  const sub = gitSubcommand(tokens)
  return sub === null || GIT_MESSAGE_SUBCOMMANDS.has(sub)
}

/**
 * Como o segmento invoca um shell: `script` (via `-c` ou here-string), `unresolved` (`-c` sem
 * script), `stdin` (lê o script da entrada: heredoc, pipe ou `-s`), `none` (não é shell, ou
 * roda um arquivo de script — fora do escopo).
 * @param {Token[]} tokens
 * @returns {{ kind: 'none' | 'unresolved' | 'stdin' } | { kind: 'script', script: string }}
 */
function shellInvocation(tokens) {
  if (!SHELLS.has(baseName(tokens[0].text))) return { kind: 'none' }
  for (let k = 1; k < tokens.length; k++) {
    const t = tokens[k].text
    if (t.startsWith('<<<')) {
      const script = t.length > 3 ? t.slice(3) : tokens[k + 1]?.text
      return script === undefined ? { kind: 'unresolved' } : { kind: 'script', script }
    }
    if (REDIRECTION.test(t)) {
      if (/^\d*[<>]+&?$/.test(t)) k++
    } else if (/^[-+]/.test(t)) {
      if (SHELL_OPTIONS_WITH_ARG.has(t)) k++
      else if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(t)) {
        const script = tokens[k + 1]?.text
        return script === undefined ? { kind: 'unresolved' } : { kind: 'script', script }
      } else if (/^-[a-zA-Z]*s[a-zA-Z]*$/.test(t)) return { kind: 'stdin' }
    } else return { kind: 'none' }
  }
  return { kind: 'stdin' }
}

/**
 * @param {string[]} argv
 * @param {boolean} ambiguous
 * @param {Partial<Segment> & { scope: string[] }} rest
 * @returns {Segment}
 */
const makeSegment = (argv, ambiguous, rest) => ({
  argv,
  ambiguous,
  pipeline: false,
  background: false,
  gitEnv: false,
  opaqueArgs: false,
  stdinScript: false,
  ...rest,
})

/**
 * Segmentos de um script interno (de `bash -c`, heredoc), herdando ambiguidade e prefixos.
 * @param {string} script
 * @param {string[]} scope
 * @param {Segment} outer
 */
function innerSegments(script, scope, outer) {
  return parseScript(script, scope).map((inner) => ({
    ...inner,
    ambiguous: inner.ambiguous || outer.ambiguous,
    gitEnv: inner.gitEnv || outer.gitEnv,
    opaqueArgs: inner.opaqueArgs || outer.opaqueArgs,
  }))
}

/**
 * @param {string} command
 * @param {string[]} scope escopo de subshell do script inteiro
 * @returns {Segment[]}
 */
function parseScript(command, scope) {
  /** @type {Segment[]} */
  const result = []
  scan(command).forEach((raw, index) => {
    const base = [...scope, ...raw.scope]
    // Substituições rodam antes do comando que as contém, cada uma num subshell.
    raw.substitutions.forEach((body, n) => {
      result.push(...parseScript(body, [...base, `c${index}.${n}`]))
    })
    const { tokens, gitEnv, opaqueArgs } = stripPrefixes(raw.tokens)
    if (!tokens.length) {
      if (gitEnv) result.push(makeSegment([], false, { scope: base, gitEnv }))
      return
    }
    const argv = tokens.map((tok) => tok.text)
    // Conservador: expansões nos prefixos descartados (`FOO=$(x) git push`) também contam.
    const ambiguous =
      raw.dynamicHeredoc ||
      tokens[0].text === 'eval' ||
      hasUnresolvedExpansion(raw.tokens, messageFlagsApply(tokens))
    const segment = makeSegment(argv, ambiguous, {
      scope: base,
      pipeline: raw.before === '|' || raw.after === '|',
      background: raw.after === '&',
      gitEnv: gitEnv || (DECLARATIONS.has(argv[0]) && argv.some((a) => GIT_ENV_ASSIGNMENT.test(a))),
      opaqueArgs,
    })
    const shell = shellInvocation(tokens)
    if (shell.kind === 'script') {
      result.push(...innerSegments(shell.script, [...base, `b${index}`], segment))
    } else if (shell.kind === 'unresolved') {
      result.push({ ...segment, ambiguous: true })
    } else if (shell.kind === 'stdin' && raw.heredocs.length) {
      result.push(...innerSegments(raw.heredocs.join('\n'), [...base, `h${index}`], segment))
    } else {
      result.push({ ...segment, stdinScript: shell.kind === 'stdin' && raw.before === '|' })
    }
  })
  return result
}

/**
 * @param {string} command
 * @returns {Segment[]}
 */
export function parseCommand(command) {
  return parseScript(command, [])
}
