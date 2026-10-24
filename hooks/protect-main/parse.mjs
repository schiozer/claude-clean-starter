// Tokenizador de comandos shell do hook protect-main.
// Quebra um comando em segmentos (`&&`, `||`, `;`, `|`, `&`, quebra de linha) e tokens,
// respeitando aspas, `$(…)`, backticks e heredocs. Não executa nem expande nada.

/**
 * @typedef {object} Segment
 * @property {string[]} argv Tokens já desembrulhados (sem `VAR=x`, `env`, `command`, `time`, `sudo`).
 * @property {boolean} ambiguous Resultado depende de expansão que não conseguimos resolver.
 */

/** @typedef {{ text: string, dynamic: boolean }} Token */

const MESSAGE_FLAGS = new Set(['-m', '--message', '-F', '--file'])
const MESSAGE_FLAG_PREFIXES = ['--message=', '--file=']
const GIT_MESSAGE_SUBCOMMANDS = new Set(['commit', 'merge', 'tag', 'notes', 'stash'])
const SHELL_OPTIONS_WITH_ARG = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file'])
const SHELLS = new Set(['bash', 'sh', 'zsh'])
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
const WRAPPERS_WITH_ARG_OPTIONS = {
  env: ['-u', '-C', '-S'],
  sudo: ['-u', '-g'],
  time: [],
  command: [],
}
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const VAR_START = /[A-Za-z_0-9{@*#?!$-]/

/**
 * Lê o corpo dos heredocs pendentes a partir da quebra de linha em `nl`.
 * @param {string} s
 * @param {number} nl índice da quebra de linha que antecede o corpo
 * @param {{ delim: string, strip: boolean, expands: boolean }[]} pending
 * @returns {{ pos: number, dynamic: boolean }} `pos`: fim da linha delimitadora (índice da quebra ou s.length)
 */
function skipHeredocBodies(s, nl, pending) {
  let pos = nl
  let dynamic = false
  for (const { delim, strip, expands } of pending) {
    let start = pos + 1
    for (;;) {
      if (start > s.length) {
        pos = s.length
        break
      }
      const end = s.indexOf('\n', start) === -1 ? s.length : s.indexOf('\n', start)
      const line = s.slice(start, end)
      if ((strip ? line.replace(/^\t+/, '') : line) === delim) {
        pos = end
        break
      }
      if (expands && (line.includes('$(') || line.includes('`'))) dynamic = true
      if (end === s.length) {
        pos = end
        break
      }
      start = end + 1
    }
  }
  return { pos, dynamic }
}

/**
 * Lê a palavra-delimitador de um heredoc em `i` (após `<<` e `-` opcionais).
 * @returns {{ delim: string, expands: boolean, end: number }}
 */
function readHeredocDelimiter(s, i) {
  while (s[i] === ' ' || s[i] === '\t') i++
  let delim = ''
  let expands = true
  while (i < s.length && !/[\s;&|()<>]/.test(s[i])) {
    if (s[i] === "'" || s[i] === '"') {
      const close = s.indexOf(s[i], i + 1)
      const stop = close === -1 ? s.length : close
      delim += s.slice(i + 1, stop)
      expands = false
      i = stop + 1
    } else {
      if (s[i] === '\\') expands = false
      else delim += s[i]
      i++
    }
  }
  return { delim, expands, end: i }
}

/**
 * Lê `$( … )` em `i` (s[i] === '$', s[i+1] === '('), com aninhamento, aspas e heredocs.
 * @returns {{ raw: string, end: number }} `end`: índice logo após o `)` de fechamento
 */
function readSubstitution(s, i) {
  let depth = 1
  let raw = '$('
  i += 2
  const pending = []
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      raw += s.slice(i, i + 2)
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < s.length && s[j] !== c) j += c === '"' && s[j] === '\\' ? 2 : 1
      raw += s.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      let j = i + 2
      const strip = s[j] === '-'
      if (strip) j++
      const { delim, expands, end } = readHeredocDelimiter(s, j)
      pending.push({ delim, strip, expands })
      raw += s.slice(i, end)
      i = end
      continue
    }
    if (c === '\n' && pending.length) {
      const { pos } = skipHeredocBodies(s, i, pending)
      pending.length = 0
      raw += '\n'
      i = pos + 1
      continue
    }
    if (c === '(') depth++
    if (c === ')') depth--
    raw += c
    i++
    if (depth === 0) break
  }
  return { raw, end: i }
}

/**
 * Divide o comando em segmentos de tokens crus (ainda sem desembrulhar wrappers).
 * @param {string} s
 * @returns {{ tokens: Token[], dynamicHeredoc: boolean }[]}
 */
function scan(s) {
  /** @type {{ tokens: Token[], dynamicHeredoc: boolean }[]} */
  const segments = []
  /** @type {Token[]} */
  let tokens = []
  let text = ''
  let started = false
  let dynamic = false
  let pending = []

  const endToken = () => {
    if (started) tokens.push({ text, dynamic })
    text = ''
    started = false
    dynamic = false
  }
  const endSegment = () => {
    endToken()
    if (tokens.length) segments.push({ tokens, dynamicHeredoc: false })
    tokens = []
  }
  const add = (chunk, isDynamic = false) => {
    text += chunk
    started = true
    if (isDynamic) dynamic = true
  }

  /** `$…` em contexto sem aspas simples; devolve o novo índice. */
  const readDollar = (i) => {
    const next = s[i + 1]
    if (next === '(') {
      const { raw, end } = readSubstitution(s, i)
      add(raw, true)
      return end
    }
    if (next === '{') {
      const close = s.indexOf('}', i)
      const end = close === -1 ? s.length : close + 1
      add(s.slice(i, end), true)
      return end
    }
    if (next !== undefined && VAR_START.test(next)) {
      add('$', true)
      return i + 1
    }
    add('$')
    return i + 1
  }

  const readBacktick = (i) => {
    let j = i + 1
    while (j < s.length && s[j] !== '`') j += s[j] === '\\' ? 2 : 1
    add(s.slice(i, j + 1), true)
    return j + 1
  }

  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "'") {
      const close = s.indexOf("'", i + 1)
      const stop = close === -1 ? s.length : close
      add(s.slice(i + 1, stop))
      i = stop + 1
    } else if (c === '"') {
      started = true
      i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') {
          const n = s[i + 1]
          if (n === '\n') {
            // continuação de linha
          } else if (n === '"' || n === '\\' || n === '$' || n === '`') add(n)
          else add('\\' + (n ?? ''))
          i += 2
        } else if (s[i] === '$') i = readDollar(i)
        else if (s[i] === '`') i = readBacktick(i)
        else add(s[i++])
      }
      i++
    } else if (c === '\\') {
      if (s[i + 1] !== '\n' && i + 1 < s.length) add(s[i + 1])
      i += 2
    } else if (c === '$' && s[i + 1] === "'") {
      i++
    } else if (c === '$') {
      i = readDollar(i)
    } else if (c === '`') {
      i = readBacktick(i)
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endToken()
      i++
    } else if (c === '\n') {
      endSegment()
      if (pending.length) {
        const { pos, dynamic: bodyDynamic } = skipHeredocBodies(s, i, pending)
        if (bodyDynamic && segments.length) segments[segments.length - 1].dynamicHeredoc = true
        pending = []
        i = pos
      }
      i++
    } else if (c === '#' && !started) {
      while (i < s.length && s[i] !== '\n') i++
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      endToken()
      let j = i + 2
      const strip = s[j] === '-'
      if (strip) j++
      const { delim, expands, end } = readHeredocDelimiter(s, j)
      pending.push({ delim, strip, expands })
      i = end
    } else if (c === '&' && (s[i - 1] === '>' || s[i - 1] === '<' || s[i + 1] === '>')) {
      add(c) // redirecionamento (`2>&1`, `&>`), não é separador
      i++
    } else if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')') {
      endSegment()
      i++
      if ((c === '&' || c === '|') && s[i] === c) i++
    } else {
      add(c)
      i++
    }
  }
  endSegment()
  return segments
}

/** Remove wrappers (`env`, `command`, `time`, `sudo`), atribuições e palavras-chave do início. */
function stripPrefixes(tokens) {
  let t = tokens
  for (;;) {
    if (!t.length) return t
    const head = t[0].text
    if (ASSIGNMENT.test(head) || KEYWORDS.has(head)) {
      t = t.slice(1)
    } else if (head in WRAPPERS_WITH_ARG_OPTIONS) {
      const takesArg = WRAPPERS_WITH_ARG_OPTIONS[head]
      let k = 1
      while (k < t.length && (t[k].text.startsWith('-') || ASSIGNMENT.test(t[k].text))) {
        k += takesArg.includes(t[k].text) ? 2 : 1
      }
      t = t.slice(k)
    } else return t
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
  if (tokens[0].text.split('/').pop() !== 'git') return null
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
 * Se o segmento é `bash|sh|zsh [opções] -c "<script>"`, devolve o script.
 * `unresolved`: é um shell com `-c`, mas não conseguimos localizar o script.
 * @returns {{ script: string | null, unresolved: boolean }}
 */
function shellScript(tokens) {
  const none = { script: null, unresolved: false }
  const name = tokens[0].text.split('/').pop() ?? ''
  if (!SHELLS.has(name)) return none
  for (let k = 1; k < tokens.length; k++) {
    const t = tokens[k].text
    if (!/^[-+]/.test(t)) return none
    if (SHELL_OPTIONS_WITH_ARG.has(t)) k++
    else if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(t)) {
      const script = tokens[k + 1]?.text ?? null
      return { script, unresolved: script === null }
    }
  }
  return none
}

/**
 * @param {string} command
 * @returns {Segment[]}
 */
export function parseCommand(command) {
  /** @type {Segment[]} */
  const result = []
  for (const { tokens: raw, dynamicHeredoc } of scan(command)) {
    const tokens = stripPrefixes(raw)
    if (!tokens.length) continue
    // Conservador: expansões nos prefixos descartados (`FOO=$(x) git push`) também contam.
    const ambiguous =
      dynamicHeredoc ||
      tokens[0].text === 'eval' ||
      hasUnresolvedExpansion(raw, messageFlagsApply(tokens))
    const { script, unresolved } = shellScript(tokens)
    if (script === null) {
      result.push({ argv: tokens.map((tok) => tok.text), ambiguous: ambiguous || unresolved })
      continue
    }
    for (const inner of parseCommand(script)) {
      result.push({ argv: inner.argv, ambiguous: inner.ambiguous || ambiguous })
    }
  }
  return result
}
