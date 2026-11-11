// Parser dos cenários de teste da spec (spec e2e-regressao-docs §4.1). Funções puras, sem
// dependências: nunca lançam em entrada malformada, devolvem `erros` com `arquivo:linha`.

export const ID_CENARIO = /^CT-[A-Z]{2,6}-\d{3}$/
export const ID_CRITERIO = /^CA-\d+$/
export const TIPOS = ['@e2e', '@sistemico', '@rnf', '@usabilidade']
export const DESTINOS = ['@regressao', '@doc', '@demo', '@treinamento']
export const PERFIS = ['usuário final', 'time interno']

const PALAVRAS_PASSO = 'Dado|Quando|Então|E|Mas'
const PASSO = new RegExp(`^(${PALAVRAS_PASSO})\\s+(.+)$`)
const PALAVRA_INICIAL = new RegExp(`^(?:${PALAVRAS_PASSO})\\s+`)
const CHAVES = ['Tipo', 'Destino', 'Critério', 'Perfil', 'Fora da regressão', 'Aposentado']
const CHAVE = new RegExp(`(${CHAVES.join('|')}):`, 'g')
const HEADING = /^###\s+(\S+)\s+—\s+(.+?)\s*$/

/** @typedef {{ path: string, linha: number, mensagem: string }} Erro */
/**
 * @typedef {{
 *   id: string, titulo: string, tipo: string, destinos: string[], criterios: string[],
 *   perfil: 'usuário final' | 'time interno' | null, foraDaRegressao: string | null,
 *   aposentado: string | null, passos: { palavra: string, texto: string }[],
 *   path: string, linha: number
 * }} Cenario
 */

/**
 * Remove a palavra inicial (Dado/Quando/Então/E/Mas), apara e colapsa espaços.
 * @param {string} s
 * @returns {string}
 */
export const normalizarPasso = (s) =>
  s.trim().replace(PALAVRA_INICIAL, '').replace(/\s+/g, ' ').trim()

/** Quebra uma linha de metadados em pares chave/valor pelas chaves conhecidas. */
const lerMetadados = (linha) => {
  const marcas = [...linha.matchAll(CHAVE)]
  if (marcas.length === 0 || marcas[0].index !== 0) return null
  return marcas.map((m, i) => ({
    chave: m[1],
    valor: linha.slice(m.index + m[0].length, marcas[i + 1]?.index ?? linha.length).trim(),
  }))
}

const tokens = (valor) => valor.split(/[\s,]+/).filter(Boolean)

/**
 * @param {string} markdown
 * @param {string} path
 * @returns {{ cenarios: Cenario[], erros: Erro[] }}
 */
export const parseCenarios = (markdown, path) => {
  /** @type {Cenario[]} */
  const cenarios = []
  /** @type {Erro[]} */
  const erros = []
  const linhas = markdown.replace(/\r\n?/g, '\n').split('\n')

  let naSecao = false
  /** @type {null | { linha: number, heading: string, corpo: { n: number, texto: string }[] }} */
  let bloco = null

  const fecharBloco = () => {
    if (bloco) processarBloco(bloco, path, cenarios, erros)
    bloco = null
  }

  linhas.forEach((texto, i) => {
    const n = i + 1
    if (/^## /.test(texto)) {
      fecharBloco()
      naSecao = texto.includes('Cenários de teste')
      return
    }
    if (!naSecao) return
    if (/^### /.test(texto)) {
      fecharBloco()
      bloco = { linha: n, heading: texto, corpo: [] }
      return
    }
    bloco?.corpo.push({ n, texto })
  })
  fecharBloco()

  return { cenarios, erros }
}

const processarBloco = (bloco, path, cenarios, erros) => {
  /** @type {Erro[]} */
  const meus = []
  const erro = (linha, mensagem) => meus.push({ path, linha, mensagem })

  const m = HEADING.exec(bloco.heading)
  const id = m?.[1] ?? ''
  const titulo = m?.[2] ?? ''
  if (!m) erro(bloco.linha, "heading fora do formato '### <ID> — <título>' (ID ausente)")
  else if (!ID_CENARIO.test(id)) erro(bloco.linha, `ID '${id}' fora do padrão CT-XXX-000`)

  let tipos = []
  let tipoLinha = bloco.linha
  let destinos = []
  let criterios = []
  let perfil = null
  let foraDaRegressao = null
  let aposentado = null
  const passos = []

  for (const { n, texto } of bloco.corpo) {
    const limpo = texto.trim()
    if (!limpo) continue
    const passo = PASSO.exec(limpo)
    if (passo) {
      passos.push({ palavra: passo[1], texto: passo[2].trim() })
      continue
    }
    const meta = lerMetadados(limpo)
    if (!meta) {
      erro(n, `linha não é passo (Dado/Quando/Então/E/Mas) nem metadado: '${limpo}'`)
      continue
    }
    for (const { chave, valor } of meta) {
      if (chave === 'Tipo') {
        tipos = tokens(valor)
        tipoLinha = n
        if (tipos.length !== 1) erro(n, `use um tipo por cenário (encontrado: '${valor}')`)
        else if (!TIPOS.includes(tipos[0])) erro(n, `Tipo '${tipos[0]}' desconhecido`)
      } else if (chave === 'Destino') {
        destinos = tokens(valor)
        for (const d of destinos) if (!DESTINOS.includes(d)) erro(n, `Destino '${d}' desconhecido`)
      } else if (chave === 'Critério') {
        criterios = tokens(valor)
        for (const c of criterios)
          if (!ID_CRITERIO.test(c)) erro(n, `Critério '${c}' fora do padrão CA-N`)
      } else if (chave === 'Perfil') {
        if (PERFIS.includes(valor)) perfil = valor
        else erro(n, `Perfil '${valor}' desconhecido (use: ${PERFIS.join(' | ')})`)
      } else if (chave === 'Fora da regressão') {
        foraDaRegressao = valor || null
        if (!valor) erro(n, 'Fora da regressão exige o motivo')
      } else if (chave === 'Aposentado') {
        aposentado = valor || null
        if (!valor) erro(n, 'Aposentado exige o motivo')
      }
    }
  }

  if (tipos.length === 0)
    erro(bloco.linha, 'falta a linha Tipo: (@e2e | @sistemico | @rnf | @usabilidade)')
  if (aposentado === null && passos.length === 0)
    erro(bloco.linha, 'cenário sem passos (Dado/Quando/Então)')

  erros.push(...meus)
  if (meus.length > 0) return
  cenarios.push({
    id,
    titulo,
    tipo: tipos[0],
    destinos: foraDaRegressao === null ? ['@regressao', ...destinos] : destinos,
    criterios,
    perfil,
    foraDaRegressao,
    aposentado,
    passos,
    path,
    linha: bloco.linha,
  })
  void tipoLinha
}

const lista = (itens) => itens.map((s) => `"${s}"`).join(', ')

/**
 * Diferença entre duas listas de passos já normalizados: faltando/sobrando ou só a ordem.
 * Fonte única da comparação: usada pelo `check-cenarios` (estático) e por `jornada()` (execução).
 * @param {string[]} esperado
 * @param {string[]} obtido
 * @returns {string | null} descrição da divergência, ou `null` se iguais.
 */
export const diffPassos = (esperado, obtido) => {
  if (esperado.length === obtido.length && esperado.every((p, i) => p === obtido[i])) return null
  const faltando = esperado.filter((p) => !obtido.includes(p))
  const sobrando = obtido.filter((p) => !esperado.includes(p))
  if (faltando.length === 0 && sobrando.length === 0) {
    return `mesmos passos em ordem diferente (esperado: ${lista(esperado)})`
  }
  const partes = []
  if (faltando.length > 0) partes.push(`faltando: ${lista(faltando)}`)
  if (sobrando.length > 0) partes.push(`sobrando: ${lista(sobrando)}`)
  return partes.join('; ')
}
