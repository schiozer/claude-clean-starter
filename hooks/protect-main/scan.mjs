// Scanner léxico do hook protect-main.
// Quebra um comando shell em segmentos crus (`&&`, `||`, `;`, `|`, `&`, `(`, `)`, quebra de
// linha) e tokens, respeitando aspas, `$(…)`, backticks e heredocs. Não executa nem expande
// nada: só registra o que precisa ser avaliado (corpos de substituição e de heredoc).

/** @typedef {{ text: string, dynamic: boolean, quoted: boolean }} Token */

/**
 * @typedef {object} RawSegment
 * @property {Token[]} tokens Tokens crus (wrappers e atribuições ainda presentes).
 * @property {boolean} dynamicHeredoc Heredoc sem aspas com `$(…)`/backticks no corpo.
 * @property {string[]} scope Caminho de subshells `( … )` em que o segmento roda.
 * @property {string} before Operador que precede o segmento (`''` no início).
 * @property {string} after Operador que encerra o segmento (`''` no fim).
 * @property {string[]} heredocs Corpos dos heredocs ligados ao segmento.
 * @property {string[]} substitutions Corpos de `$(…)`/backticks do segmento, em ordem.
 */

/** @typedef {{ delim: string, strip: boolean, expands: boolean, owner: RawSegment }} Heredoc */

const VAR_START = /[A-Za-z_0-9{@*#?!$-]/
const BRACE_EXPANSION = /^\{[^\s;&|()<>{}'"`$]*\}/

/** Desfaz os escapes de um corpo entre backticks (`\``, `\$`, `\\`). */
const unescapeBackticks = (body) => body.replace(/\\([`$\\])/g, '$1')

/**
 * Lê o corpo dos heredocs pendentes a partir da quebra de linha em `nl`.
 * @param {string} s
 * @param {number} nl índice da quebra de linha que antecede o corpo
 * @param {Omit<Heredoc, 'owner'>[]} pending
 * @returns {{ pos: number, bodies: string[] }} `pos`: fim da linha delimitadora
 */
function readHeredocBodies(s, nl, pending) {
  let pos = nl
  const bodies = []
  for (const { delim, strip } of pending) {
    const lines = []
    let start = pos + 1
    for (;;) {
      if (start > s.length) {
        pos = s.length
        break
      }
      const found = s.indexOf('\n', start)
      const end = found === -1 ? s.length : found
      const line = s.slice(start, end)
      if ((strip ? line.replace(/^\t+/, '') : line) === delim) {
        pos = end
        break
      }
      lines.push(line)
      if (end === s.length) {
        pos = end
        break
      }
      start = end + 1
    }
    bodies.push(lines.join('\n'))
  }
  return { pos, bodies }
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
 * `raw` omite os corpos de heredoc; `body` é o texto-fonte entre os parênteses (com eles).
 * @returns {{ raw: string, body: string, end: number }} `end`: índice logo após o `)`
 */
function readSubstitution(s, i) {
  const start = i + 2
  let depth = 1
  let raw = '$('
  i = start
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
    if (c === '<' && s[i + 1] === '<' && s[i + 2] === '<') {
      raw += '<<<'
      i += 3
      continue
    }
    if (c === '<' && s[i + 1] === '<') {
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
      const { pos } = readHeredocBodies(s, i, pending)
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
  const body = s.slice(start, depth === 0 ? i - 1 : i)
  return { raw, body, end: i }
}

/** Índice do backtick que fecha o de `i` (ou s.length). */
function backtickEnd(s, i) {
  let j = i + 1
  while (j < s.length && s[j] !== '`') j += s[j] === '\\' ? 2 : 1
  return j
}

/**
 * Corpos de `$(…)` e backticks num texto sem aspas de shell (corpo de heredoc que expande,
 * conteúdo de `${…}`).
 * @param {string} text
 * @returns {string[]}
 */
export function collectSubstitutions(text) {
  const bodies = []
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\') i += 2
    else if (text[i] === '$' && text[i + 1] === '(') {
      const { body, end } = readSubstitution(text, i)
      bodies.push(body)
      i = end
    } else if (text[i] === '`') {
      const end = backtickEnd(text, i)
      bodies.push(unescapeBackticks(text.slice(i + 1, end)))
      i = end + 1
    } else i++
  }
  return bodies
}

/** @returns {RawSegment} */
const newSegment = (before) => ({
  tokens: [],
  dynamicHeredoc: false,
  scope: [],
  before,
  after: '',
  heredocs: [],
  substitutions: [],
})

/**
 * Divide o comando em segmentos crus.
 * @param {string} s
 * @returns {RawSegment[]}
 */
export function scan(s) {
  /** @type {RawSegment[]} */
  const segments = []
  /** @type {string[]} */
  const scopes = []
  let subshells = 0
  let cur = newSegment('')
  let text = ''
  let started = false
  let dynamic = false
  let quoted = false
  /** @type {Heredoc[]} */
  let pending = []

  const endToken = () => {
    if (started) cur.tokens.push({ text, dynamic, quoted })
    text = ''
    started = false
    dynamic = false
    quoted = false
  }
  const endSegment = (op) => {
    endToken()
    cur.after = op
    cur.scope = [...scopes]
    if (cur.tokens.length) segments.push(cur)
    cur = newSegment(op)
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
      const { raw, body, end } = readSubstitution(s, i)
      cur.substitutions.push(body)
      add(raw, true)
      return end
    }
    if (next === '{') {
      const close = s.indexOf('}', i)
      const end = close === -1 ? s.length : close + 1
      cur.substitutions.push(...collectSubstitutions(s.slice(i + 2, end)))
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
    const end = backtickEnd(s, i)
    cur.substitutions.push(unescapeBackticks(s.slice(i + 1, end)))
    add(s.slice(i, end + 1), true)
    return end + 1
  }

  /** `$'…'` (ANSI-C): com `\` o valor depende de escapes que não resolvemos. */
  const readAnsiC = (i) => {
    let j = i + 2
    while (j < s.length && s[j] !== "'") j += s[j] === '\\' ? 2 : 1
    const content = s.slice(i + 2, j)
    add(content, content.includes('\\'))
    return j + 1
  }

  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '\\') quoted = true
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
      quoted = true
      i = readAnsiC(i)
    } else if (c === '$') {
      i = readDollar(i)
    } else if (c === '`') {
      i = readBacktick(i)
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endToken()
      i++
    } else if (c === '\n') {
      endSegment('\n')
      if (pending.length) {
        const { pos, bodies } = readHeredocBodies(s, i, pending)
        pending.forEach(({ expands, owner }, n) => {
          owner.heredocs.push(bodies[n])
          if (!expands) return
          const subs = collectSubstitutions(bodies[n])
          owner.substitutions.push(...subs)
          if (subs.length) owner.dynamicHeredoc = true
        })
        pending = []
        i = pos
      }
      i++
    } else if (c === '#' && !started) {
      while (i < s.length && s[i] !== '\n') i++
    } else if (c === '<' && s[i + 1] === '<' && s[i + 2] === '<') {
      add('<<<') // here-string: o texto seguinte é a entrada do comando
      i += 3
    } else if (c === '<' && s[i + 1] === '<') {
      endToken()
      let j = i + 2
      const strip = s[j] === '-'
      if (strip) j++
      const { delim, expands, end } = readHeredocDelimiter(s, j)
      pending.push({ delim, strip, expands, owner: cur })
      i = end
    } else if (c === '&' && (s[i - 1] === '>' || s[i - 1] === '<' || s[i + 1] === '>')) {
      add(c) // redirecionamento (`2>&1`, `&>`), não é separador
      i++
    } else if (c === '|' && s[i - 1] === '>' && started) {
      add(c) // `>|` (clobber) é redirecionamento, não pipe
      i++
    } else if (c === '|' && s[i + 1] === '&') {
      endSegment('|') // `|&` = pipe de stdout + stderr
      i += 2
    } else if (c === ';' || c === '&' || c === '|') {
      const double = s[i + 1] === c
      endSegment(double ? c + c : c)
      i += double ? 2 : 1
    } else if (c === '(') {
      endSegment('(')
      scopes.push(`p${++subshells}`)
      i++
    } else if (c === ')') {
      endSegment(')')
      scopes.pop()
      i++
    } else {
      const brace = c === '{' ? BRACE_EXPANSION.exec(s.slice(i)) : null
      add(c, brace !== null && /,|\.\./.test(brace[0]))
      i++
    }
  }
  endSegment('')
  return segments
}

/**
 * Palavras de um texto (sem operadores), para reinterpretar `env -S "<texto>"`.
 * @param {string} s
 * @returns {Token[]}
 */
export const scanWords = (s) => scan(s).flatMap((seg) => seg.tokens)
