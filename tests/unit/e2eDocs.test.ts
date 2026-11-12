import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { contemSegredo, makeGanchoDeDocs, nomeDaImagem } from '../e2e/support/docs'
import type { PassoCtx } from '../e2e/support/jornada'

const PAT = 'pat_e2e_local_dev_token_000000000000'

describe('contemSegredo', () => {
  it('acha o PAT no HTML e devolve o nome da variável, nunca o valor', () => {
    const achado = contemSegredo(`<p>token: ${PAT}</p>`, { DEV_PERSONAL_TOKEN: PAT })
    expect(achado).toBe('DEV_PERSONAL_TOKEN')
  })

  it.each([
    ['E2E_PAT_OUTRO_ATOR', 'pat_outro_ator_123456'],
    ['E2E_SESSION_SECRET', 'segredo-de-sessao-123'],
    ['E2E_FAULTS_SECRET', 'segredo-de-falhas-123'],
    ['E2E_USUARIO_SENHA', 'senha-do-usuario'],
    ['E2E_INTERNO_SENHA', 'senha-do-interno'],
    ['VERCEL_AUTOMATION_BYPASS_SECRET', 'bypass-da-vercel-123'],
  ])('acha %s', (nome, valor) => {
    expect(contemSegredo(`<div>${valor}</div>`, { [nome]: valor })).toBe(nome)
  })

  it('ignora segredo vazio ou curto (< 8 caracteres)', () => {
    const env = { DEV_PERSONAL_TOKEN: '', E2E_PAT_USUARIO: 'abc1234', E2E_FAULTS_SECRET: '   ' }
    expect(contemSegredo('<p>abc1234</p>', env)).toBeNull()
  })

  it('ignora variáveis que não são segredo', () => {
    expect(
      contemSegredo('<p>http://localhost:3100</p>', { E2E_BASE_URL: 'http://localhost:3100' })
    ).toBeNull()
  })

  it('HTML sem segredo → null', () => {
    expect(contemSegredo('<p>Plano de estudos</p>', { DEV_PERSONAL_TOKEN: PAT })).toBeNull()
  })
})

describe('nomeDaImagem', () => {
  it('índice do passo (a partir de 0) vira NN.png a partir de 01', () => {
    expect(nomeDaImagem(0)).toBe('01.png')
    expect(nomeDaImagem(9)).toBe('10.png')
  })
})

interface FakePage {
  html: string
  /** `.value` dos `input`/`textarea` (o `content()` não serializa o que o `fill` digitou). */
  valores: string[]
  shots: { path: string; mask: unknown[] }[]
}

const fakePage = (estado: FakePage): Page =>
  ({
    content: async () => estado.html,
    locator: (seletor: string) => ({
      seletor,
      evaluateAll: async () => (seletor === 'input, textarea' ? estado.valores : []),
    }),
    screenshot: async (opts: { path: string; mask: unknown[] }) => {
      estado.shots.push(opts)
      mkdirSync(join(opts.path, '..'), { recursive: true })
      writeFileSync(opts.path, 'png')
      return Buffer.from('png')
    },
  }) as unknown as Page

const PASSOS = [
  { palavra: 'Dado', texto: 'que estou logado como usuário final' },
  { palavra: 'Quando', texto: 'abro a lista de recursos' },
]

const ctx = (indice: number, page: Page, destinos = ['@regressao', '@doc']): PassoCtx => ({
  id: 'CT-RES-001',
  indice,
  palavra: PASSOS[indice]!.palavra,
  texto: PASSOS[indice]!.texto,
  page,
  cenario: {
    id: 'CT-RES-001',
    titulo: 'Criar um recurso e vê-lo na lista',
    tipo: '@e2e',
    destinos,
    criterios: ['CA-1'],
    perfil: 'usuário final',
    foraDaRegressao: null,
    aposentado: null,
    passos: PASSOS,
    path: 'docs/specs/resources.md',
    linha: 10,
  },
})

describe('makeGanchoDeDocs', () => {
  let dir: string
  let estado: FakePage

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ajuda-'))
    estado = { html: '<p>ok</p>', valores: [], shots: [] }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const gancho = (projeto = 'desktop', env = {}) =>
    makeGanchoDeDocs({ dir, projeto: () => projeto, env })

  it('captura um screenshot por passo com máscara e escreve o JSON no último passo', async () => {
    const page = fakePage(estado)
    const g = gancho()
    await g(ctx(0, page))
    expect(existsSync(join(dir, 'RES/CT-RES-001.json')), 'JSON só ao fim').toBe(false)
    await g(ctx(1, page))

    expect(estado.shots.map((s) => s.path)).toEqual([
      join(dir, 'RES/CT-RES-001/01.png'),
      join(dir, 'RES/CT-RES-001/02.png'),
    ])
    expect(estado.shots[0]!.mask).toMatchObject([{ seletor: '[data-sensivel]' }])
    expect(JSON.parse(readFileSync(join(dir, 'RES/CT-RES-001.json'), 'utf8'))).toEqual({
      id: 'CT-RES-001',
      titulo: 'Criar um recurso e vê-lo na lista',
      perfil: 'usuário final',
      passos: [
        { texto: 'Dado que estou logado como usuário final', imagem: '01.png' },
        { texto: 'Quando abro a lista de recursos', imagem: '02.png' },
      ],
    })
  })

  it('no 1º passo apaga imagens de uma geração anterior', async () => {
    mkdirSync(join(dir, 'RES/CT-RES-001'), { recursive: true })
    writeFileSync(join(dir, 'RES/CT-RES-001/09.png'), 'velha')
    await gancho()(ctx(0, fakePage(estado)))
    expect(existsSync(join(dir, 'RES/CT-RES-001/09.png'))).toBe(false)
  })

  it('segredo na tela → falha antes do screenshot, com o nome da variável', async () => {
    estado.html = `<p>${PAT}</p>`
    await expect(
      gancho('desktop', { DEV_PERSONAL_TOKEN: PAT })(ctx(0, fakePage(estado)))
    ).rejects.toThrow(/DEV_PERSONAL_TOKEN/)
    expect(estado.shots).toEqual([])
  })

  it('segredo digitado num campo (só no .value, fora do HTML) → também falha', async () => {
    estado.valores = ['Plano de estudos', PAT]
    await expect(
      gancho('desktop', { DEV_PERSONAL_TOKEN: PAT })(ctx(0, fakePage(estado)))
    ).rejects.toThrow(/DEV_PERSONAL_TOKEN/)
    expect(estado.shots).toEqual([])
  })

  it('a mensagem diz para não exibir o valor (data-sensivel só tarja, o DOM continua varrido)', async () => {
    estado.html = `<input data-sensivel value="${PAT}">`
    await expect(
      gancho('desktop', { DEV_PERSONAL_TOKEN: PAT })(ctx(0, fakePage(estado)))
    ).rejects.toThrow(/não exiba o valor na tela; campos `data-sensivel` são tarjados/)
  })

  it('a mensagem de erro nunca traz o valor do segredo', async () => {
    estado.html = `<p>${PAT}</p>`
    const erro = await gancho('desktop', { DEV_PERSONAL_TOKEN: PAT })(
      ctx(0, fakePage(estado))
    ).catch((e: unknown) => e)
    expect(String(erro)).not.toContain(PAT)
  })

  it('fora do projeto desktop não faz nada (mobile não sobrescreve as imagens)', async () => {
    await gancho('mobile')(ctx(0, fakePage(estado)))
    expect(estado.shots).toEqual([])
  })

  it('cenário sem @doc ou passo sem page → não faz nada', async () => {
    const page = fakePage(estado)
    await gancho()(ctx(0, page, ['@regressao']))
    await gancho()({ ...ctx(0, page), page: undefined })
    expect(estado.shots).toEqual([])
  })
})
