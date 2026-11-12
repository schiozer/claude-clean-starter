import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { TestCase, TestResult } from '@playwright/test/reporter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import DemosReporter from '../e2e/support/demosReporter'
import {
  CHAVE_LEGENDA,
  LEGENDA_ID,
  ehCenarioDeVideo,
  instalarLegenda,
  makeGanchoDeLegenda,
} from '../e2e/support/demos'
import type { PassoCtx } from '../e2e/support/jornada'

const PASSOS = [
  { palavra: 'Dado', texto: 'que estou logado como usuário final' },
  { palavra: 'Quando', texto: 'abro a lista de recursos' },
]

interface Chamadas {
  addInitScript: unknown[]
  initArgs: unknown[]
  evaluate: { fn: unknown; arg: unknown }[]
}

const fakePage = (chamadas: Chamadas): Page =>
  ({
    addInitScript: async (fn: unknown, arg?: unknown) => {
      chamadas.addInitScript.push(fn)
      chamadas.initArgs.push(arg)
    },
    evaluate: async (fn: unknown, arg?: unknown) => {
      chamadas.evaluate.push({ fn, arg })
    },
  }) as unknown as Page

const ctx = (indice: number, page: Page, destinos: string[]): PassoCtx => ({
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

describe('ehCenarioDeVideo', () => {
  it.each([
    [['@regressao', '@demo'], true],
    [['@treinamento'], true],
    [['@regressao', '@doc'], false],
  ])('%j → %s', (destinos, esperado) => {
    expect(
      ehCenarioDeVideo(
        ctx(0, fakePage({ addInitScript: [], initArgs: [], evaluate: [] }), destinos).cenario
      )
    ).toBe(esperado)
  })
})

describe('makeGanchoDeLegenda', () => {
  let chamadas: Chamadas
  beforeEach(() => {
    chamadas = { addInitScript: [], initArgs: [], evaluate: [] }
  })

  it('cenário só @doc → nenhuma chamada na page', async () => {
    const page = fakePage(chamadas)
    await makeGanchoDeLegenda()(ctx(0, page, ['@regressao', '@doc']))
    expect(chamadas).toEqual({ addInitScript: [], initArgs: [], evaluate: [] })
  })

  it('sem page → não faz nada', async () => {
    const c = ctx(0, fakePage(chamadas), ['@demo'])
    delete c.page
    await expect(makeGanchoDeLegenda()(c)).resolves.toBeUndefined()
    expect(chamadas.evaluate).toEqual([])
  })

  it('@demo: instala a legenda no passo 0 e grava o texto em todo passo', async () => {
    const page = fakePage(chamadas)
    const gancho = makeGanchoDeLegenda()

    await gancho(ctx(0, page, ['@demo']))
    expect(chamadas.addInitScript).toEqual([instalarLegenda])
    expect(chamadas.initArgs).toEqual(['Dado que estou logado como usuário final'])
    expect(chamadas.evaluate[0]!.fn).toBe(instalarLegenda)
    expect(JSON.stringify(chamadas.evaluate[1]!.arg)).toContain(
      'Dado que estou logado como usuário final'
    )

    await gancho(ctx(1, page, ['@demo']))
    expect(chamadas.addInitScript).toHaveLength(1)
    expect(JSON.stringify(chamadas.evaluate.at(-1)!.arg)).toContain(
      'Quando abro a lista de recursos'
    )
  })
})

describe('instalarLegenda', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    sessionStorage.clear()
  })

  it('rodada 2x cria uma só legenda, aria-hidden, com o texto do sessionStorage', () => {
    sessionStorage.setItem(CHAVE_LEGENDA, 'Quando abro a lista de recursos')
    instalarLegenda()
    instalarLegenda()
    const legendas = document.querySelectorAll(`#${LEGENDA_ID}`)
    expect(legendas).toHaveLength(1)
    expect(legendas[0]!.getAttribute('aria-hidden')).toBe('true')
    expect(legendas[0]!.textContent).toBe('Quando abro a lista de recursos')
  })

  it('a semente preenche a chave vazia e aparece na legenda', () => {
    instalarLegenda('Dado que abro a lista')
    expect(sessionStorage.getItem(CHAVE_LEGENDA)).toBe('Dado que abro a lista')
    expect(document.getElementById(LEGENDA_ID)!.textContent).toBe('Dado que abro a lista')
  })

  it('a semente não sobrescreve um passo já gravado', () => {
    sessionStorage.setItem(CHAVE_LEGENDA, 'Quando abro a lista de recursos')
    instalarLegenda('Dado que abro a lista')
    expect(sessionStorage.getItem(CHAVE_LEGENDA)).toBe('Quando abro a lista de recursos')
  })

  it('pointerdown destaca o alvo com outline por um instante', () => {
    instalarLegenda()
    const botao = document.createElement('button')
    document.body.append(botao)
    botao.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(botao.style.outlineWidth).toBe('3px')
    expect(botao.style.outlineStyle).toBe('solid')
  })
})

describe('DemosReporter', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'demos-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const teste = (titulo: string, projeto: string) =>
    ({ title: titulo, parent: { project: () => ({ name: projeto }) } }) as unknown as TestCase
  const resultado = (status: string, video?: string) =>
    ({
      status,
      attachments: video
        ? [
            { name: 'trace', path: '/x/trace.zip', contentType: 'application/zip' },
            { name: 'video', path: video, contentType: 'video/webm' },
          ]
        : [],
    }) as unknown as TestResult

  it('grava o manifesto só com testes que têm ID e vídeo', async () => {
    const saida = join(dir, 'sub/manifesto.json')
    const r = new DemosReporter({ saida })
    r.onTestEnd(teste('CT-RES-001 — Criar…', 'desktop'), resultado('passed', '/v/d.webm'))
    r.onTestEnd(teste('CT-RES-001 …', 'mobile'), resultado('failed', '/v/m.webm'))
    r.onTestEnd(teste('sem id', 'desktop'), resultado('passed', '/v/x.webm'))
    r.onTestEnd(teste('CT-RES-002 sem vídeo', 'desktop'), resultado('passed'))
    r.onEnd()

    expect(existsSync(saida)).toBe(true)
    expect(JSON.parse(readFileSync(saida, 'utf8'))).toEqual({
      videos: [
        { id: 'CT-RES-001', projeto: 'desktop', arquivo: '/v/d.webm', ok: true },
        { id: 'CT-RES-001', projeto: 'mobile', arquivo: '/v/m.webm', ok: false },
      ],
    })
  })
})
