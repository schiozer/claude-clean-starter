// Parser do baseline de RNF (`docs/rnf.md`, spec e2e-regressao-docs §5). Funções puras:
// nunca lançam em entrada malformada, devolvem `erros` com a linha (1-based).

export const ID_RNF = /^RNF-[A-Z]{3}-\d{3}$/
export const ID_USABILIDADE = /^USA-\d{3}$/

const VALOR = /^(\d+(?:[ .]\d{3})*)\s*(ms|s|min|h|d|px)$/
const MS_POR_UNIDADE = { ms: 1, s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000 }

/** @typedef {{ path: string, linha: number, mensagem: string }} Erro */
/** @typedef {'ms' | 's' | 'min' | 'h' | 'd' | 'px'} Unidade */
/**
 * @typedef {{
 *   id: string, categoria: string, requisito: string,
 *   valor: { numero: number, unidade: Unidade } | null
 * }} Requisito
 */

const celulas = (linha) =>
  linha
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim().replace(/^`(.*)`$/, '$1'))

const ehSeparador = (cels) => cels.every((c) => /^:?-+:?$/.test(c))

/**
 * @param {string} markdown
 * @param {string} path
 * @returns {{
 *   requisitos: Requisito[], telas: { rota: string, nome: string }[],
 *   exclusoes: string[], parametros: Record<string, string>, erros: Erro[]
 * }} `parametros`: tabela `| Chave | Valor |` de `## Parâmetros dos testes` (crases removidas).
 */
export const parseRnf = (markdown, path) => {
  const requisitos = []
  const telas = []
  const exclusoes = []
  /** @type {Record<string, string>} */
  const parametros = {}
  const erros = []
  const erro = (linha, mensagem) => erros.push({ path, linha, mensagem })

  let secao = 'requisitos'
  markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((texto, i) => {
      const n = i + 1
      const heading = /^## (.+)$/.exec(texto)
      if (heading) {
        const nome = heading[1].trim().toLowerCase()
        secao = nome.startsWith('telas')
          ? 'telas'
          : nome.startsWith('exclus')
            ? 'exclusoes'
            : /^par[âa]metros/.test(nome)
              ? 'parametros'
              : 'requisitos'
        return
      }
      if (secao === 'exclusoes') {
        const item = /^\s*-\s+(.+?)\s*$/.exec(texto)
        if (item) exclusoes.push(item[1].replace(/^`(.*)`$/, '$1'))
        return
      }
      if (!texto.trim().startsWith('|')) return
      const cels = celulas(texto)
      if (ehSeparador(cels)) return

      if (secao === 'parametros') {
        const [chave = '', bruto = ''] = cels
        if (chave === 'Chave') return
        const valor = bruto.replace(/`/g, '').trim()
        if (!chave) return erro(n, 'parâmetro sem chave')
        if (Object.hasOwn(parametros, chave)) return erro(n, `parâmetro '${chave}' repetido`)
        if (!valor) return erro(n, `parâmetro '${chave}' com valor vazio`)
        parametros[chave] = valor
        return
      }

      if (secao === 'telas') {
        if (cels[0].toLowerCase() === 'rota') return
        if (!cels[0].startsWith('/')) return erro(n, `rota '${cels[0]}' deve começar com /`)
        telas.push({ rota: cels[0], nome: cels[1] ?? '' })
        return
      }

      if (cels[0] === 'ID') return
      const [id, categoria = '', requisito = '', bruto = ''] = cels
      if (!ID_RNF.test(id) && !ID_USABILIDADE.test(id)) {
        return erro(n, `ID '${id}' fora do padrão (RNF-XXX-000 ou USA-000)`)
      }
      if (ID_USABILIDADE.test(id) && categoria !== 'Usabilidade') {
        return erro(n, `ID '${id}' exige Categoria = Usabilidade`)
      }
      let valor = null
      if (bruto !== '—' && bruto !== '') {
        const v = VALOR.exec(bruto)
        if (!v) return erro(n, `Valor '${bruto}' inválido (use '10000 ms', '8 h' ou —)`)
        valor = {
          numero: Number(v[1].replace(/[ .]/g, '')),
          unidade: /** @type {Unidade} */ (v[2]),
        }
      }
      requisitos.push({ id, categoria, requisito, valor })
    })

  return { requisitos, telas, exclusoes, parametros, erros }
}

/**
 * @param {Requisito} r
 * @returns {number}
 */
export const valorEmMs = (r) => {
  if (!r.valor) throw new Error(`${r.id}: requisito sem valor`)
  const fator = MS_POR_UNIDADE[r.valor.unidade]
  if (fator === undefined) throw new Error(`${r.id}: unidade '${r.valor.unidade}' não é de tempo`)
  return r.valor.numero * fator
}
