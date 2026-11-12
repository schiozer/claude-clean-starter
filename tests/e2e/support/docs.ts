// Gancho de documentação (spec e2e-regressao-docs §9.1): com `npm run docs:gerar` (`E2E_DOCS=1`),
// cada passo de um cenário `@doc` vira um screenshot e, ao fim do último passo, a página de ajuda
// `<ajuda>/<CTX>/<ID>.json` (formato `AjudaDoc` do `check-cenarios`). Sem Playwright em tempo de
// execução: testável no Vitest (`tests/unit/e2eDocs.test.ts`).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Env } from './env'
import type { GanchoDePasso } from './jornada'

/** Segredos mais curtos que isso não são procurados (falso positivo em qualquer texto). */
export const SEGREDO_MIN = 8

/** Projeto do Playwright que gera a documentação (o mobile sobrescreveria as imagens). */
export const PROJETO_DOCS = 'desktop'

/** Elementos marcados assim saem tarjados no screenshot (`mask` do Playwright). */
export const SELETOR_SENSIVEL = '[data-sensivel]'

/** Campos cujo `.value` também é varrido em busca de segredo. */
const CAMPOS = 'input, textarea'

/** Variáveis cujo valor nunca pode aparecer numa tela capturada. */
const ehSegredo = (nome: string): boolean =>
  /^E2E_.*SECRET/.test(nome) ||
  nome.startsWith('E2E_PAT_') ||
  nome === 'DEV_PERSONAL_TOKEN' ||
  nome === 'VERCEL_AUTOMATION_BYPASS_SECRET' ||
  /^E2E_.+_SENHA$/.test(nome)

/**
 * Nome da 1ª variável de segredo (`E2E_*SECRET*`, `E2E_PAT_*`, `DEV_PERSONAL_TOKEN`,
 * `VERCEL_AUTOMATION_BYPASS_SECRET`, senha de perfil `E2E_<PERFIL>_SENHA`) cujo valor aparece no texto; `null` se nenhuma. Devolve o nome,
 * nunca o valor.
 */
export const contemSegredo = (texto: string, env: Env): string | null => {
  for (const [nome, valor] of Object.entries(env)) {
    if (!ehSegredo(nome)) continue
    const segredo = valor?.trim() ?? ''
    if (segredo.length >= SEGREDO_MIN && texto.includes(segredo)) return nome
  }
  return null
}

/** Arquivo do screenshot do passo: `indice` começa em 0, o nome em `01.png`. */
export const nomeDaImagem = (indice: number): string => `${String(indice + 1).padStart(2, '0')}.png`

/** Sigla do contexto no ID do cenário (`CT-RES-001` → `RES`). */
const contextoDe = (id: string): string => id.split('-')[1] ?? id

/**
 * Gancho de passo que gera a documentação de ajuda em `dir` (o `ajuda` do `cenarios.config.json`).
 * Só age em cenário `@doc`, em passo com `page` e no projeto `desktop`.
 */
export const makeGanchoDeDocs = ({
  dir,
  projeto,
  env = process.env,
}: {
  dir: string
  projeto: () => string
  env?: Env
}): GanchoDePasso => {
  return async ({ id, indice, cenario, page }) => {
    if (!page || !cenario.destinos.includes('@doc') || projeto() !== PROJETO_DOCS) return

    const pasta = join(dir, contextoDe(id), id)
    if (indice === 0) rmSync(pasta, { recursive: true, force: true })

    // Fail-closed: varre o DOM inteiro, inclusive `[data-sensivel]` (a máscara só tarja a imagem),
    // e o `.value` dos campos, que o `content()` não serializa quando o valor veio do `fill`.
    const valores = await page
      .locator(CAMPOS)
      .evaluateAll((els) => els.map((e) => ('value' in e ? String(e.value) : '')))
    const segredo = contemSegredo([await page.content(), ...valores].join('\n'), env)
    if (segredo) {
      throw new Error(
        `docs: a tela do passo ${indice + 1} de ${id} mostra o valor de ${segredo}; não exiba o valor na tela; campos \`data-sensivel\` são tarjados, mas o valor não pode estar no DOM`
      )
    }
    mkdirSync(pasta, { recursive: true })
    await page.screenshot({
      path: join(pasta, nomeDaImagem(indice)),
      mask: [page.locator(SELETOR_SENSIVEL)],
    })

    if (indice !== cenario.passos.length - 1) return
    const doc = {
      id,
      titulo: cenario.titulo,
      perfil: cenario.perfil ?? 'usuário final',
      passos: cenario.passos.map((p, i) => ({
        texto: `${p.palavra} ${p.texto}`,
        imagem: nomeDaImagem(i),
      })),
    }
    writeFileSync(join(dir, contextoDe(id), `${id}.json`), `${JSON.stringify(doc, null, 2)}\n`)
  }
}
