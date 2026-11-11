// Varredura estática dos testes Playwright (spec e2e-regressao-docs §4.2). Lê o código com o
// parser do TypeScript, sem executá-lo: nunca lança em entrada malformada, devolve `erros`.
import ts from 'typescript'
import { normalizarPasso } from './cenarios.mjs'

const ID_TESTE = /^(CT-[A-Z]{2,6}-\d{3}|RNF-[A-Z]{3}-\d{3}|USA-\d{3})(?![\w-])/

/** @typedef {import('./cenarios.mjs').Erro} Erro */
/**
 * @typedef {{
 *   id: string, titulo: string, tags: string[], passos: string[] | null,
 *   path: string, linha: number
 * }} TesteRef
 */

const ehLiteral = (n) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))

/** `test`, `test.describe`, `test.only`... (raiz da cadeia de acesso é o identificador `test`). */
const ehChamadaTest = (call) => {
  let e = call.expression
  while (ts.isPropertyAccessExpression(e)) e = e.expression
  return ts.isIdentifier(e) && e.text === 'test'
}

const ehJornada = (call) => ts.isIdentifier(call.expression) && call.expression.text === 'jornada'

const lerTags = (opcoes) => {
  if (!opcoes || !ts.isObjectLiteralExpression(opcoes)) return []
  const prop = opcoes.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'tag'
  )
  if (!prop || !ts.isPropertyAssignment(prop)) return []
  const v = prop.initializer
  if (ehLiteral(v)) return [v.text]
  if (ts.isArrayLiteralExpression(v)) return v.elements.filter(ehLiteral).map((e) => e.text)
  return []
}

/** Procura chamadas `jornada(...)` no corpo, sem descer em outros `test(...)` aninhados. */
const acharJornadas = (no, achadas = []) => {
  ts.forEachChild(no, (filho) => {
    if (ts.isCallExpression(filho)) {
      if (ehJornada(filho)) achadas.push(filho)
      else if (ehChamadaTest(filho)) return
    }
    acharJornadas(filho, achadas)
  })
  return achadas
}

/**
 * @param {string} source
 * @param {string} path
 * @returns {{ refs: TesteRef[], erros: Erro[] }}
 */
export const scanTestes = (source, path) => {
  /** @type {TesteRef[]} */
  const refs = []
  /** @type {Erro[]} */
  const erros = []
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const linhaDe = (no) => sf.getLineAndCharacterOfPosition(no.getStart(sf)).line + 1
  const erro = (no, mensagem) => erros.push({ path, linha: linhaDe(no), mensagem })

  const lerJornada = (call, id) => {
    const [idArg, passosArg] = call.arguments
    if (ehLiteral(idArg) && idArg.text !== id)
      erro(call, `jornada('${idArg.text}') não bate com o ID do teste '${id}'`)
    if (!passosArg || !ts.isObjectLiteralExpression(passosArg)) {
      erro(call, 'chave de passo não literal: o 2º argumento de jornada deve ser um objeto literal')
      return []
    }
    const passos = []
    for (const p of passosArg.properties) {
      const nome = ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) ? p.name : null
      if (ts.isShorthandPropertyAssignment(p)) passos.push(normalizarPasso(p.name.text))
      else if (nome && (ts.isIdentifier(nome) || ehLiteral(nome)))
        passos.push(normalizarPasso(nome.text))
      else if (nome && ts.isComputedPropertyName(nome) && ehLiteral(nome.expression))
        passos.push(normalizarPasso(nome.expression.text))
      else erro(p, `chave de passo não literal em jornada('${id}'): '${p.getText(sf)}'`)
    }
    return passos
  }

  const visitar = (no) => {
    if (ts.isCallExpression(no) && ehChamadaTest(no) && ehLiteral(no.arguments[0])) {
      const titulo = no.arguments[0].text
      const id = ID_TESTE.exec(titulo)?.[1]
      if (id) {
        const jornadas = no.arguments.length > 1 ? acharJornadas(no.arguments.at(-1)) : []
        const passos = jornadas.length > 0 ? jornadas.flatMap((j) => lerJornada(j, id)) : null
        refs.push({
          id,
          titulo,
          tags: lerTags(no.arguments[1]),
          passos,
          path,
          linha: linhaDe(no),
        })
      }
    }
    ts.forEachChild(no, visitar)
  }
  visitar(sf)

  return { refs, erros }
}
