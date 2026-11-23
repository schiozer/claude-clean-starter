import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  abrirBackPromotion,
  corpoDaBackPromotion,
  tagDoSha,
  tituloDaBackPromotion,
} from '../../scripts/esteira/backPromotion.mjs'

const ROOT = resolve(__dirname, '../..')
const SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const ESTEIRA = {
  integracao: 'develop',
  producao: 'main',
  prefixoHotfix: 'hotfix/',
  promotores: ['fulano'],
}
const REPO = { full_name: 'dono/repo' }

type Chamada = { method: string; path: string; body?: Record<string, unknown> }
type Pr = {
  number: number
  title: string
  head: { ref: string; repo: { full_name: string } | null }
  base: { ref: string; repo: { full_name: string } }
}

interface Opcoes {
  abertos?: Pr[]
  mergeable?: (boolean | null)[]
}

function cenario(o: Opcoes = {}) {
  const chamadas: Chamada[] = []
  const mergeable = [...(o.mergeable ?? [true])]
  const github = {
    call: vi.fn(async (method: string, path: string, corpo?: unknown) => {
      const body = corpo as Record<string, unknown> | undefined
      chamadas.push({ method, path, body })
      if (method === 'GET' && path.startsWith('/pulls?')) return o.abertos ?? []
      if (method === 'POST' && path === '/pulls') return { number: 42 }
      if (method === 'GET' && /^\/pulls\/\d+$/.test(path)) {
        return { mergeable: mergeable.length > 1 ? mergeable.shift() : mergeable[0] }
      }
      return {}
    }),
  }
  const sleep = vi.fn(async () => {})
  return { github, chamadas, sleep }
}

const aberto = (over: Partial<Pr> = {}): Pr => ({
  number: 7,
  title: 'chore(release): back-promotion de v1.2.3',
  head: { ref: 'main', repo: REPO },
  base: { ref: 'develop', repo: REPO },
  ...over,
})

const comentarios = (chamadas: Chamada[]) =>
  chamadas.filter((c) => c.method === 'POST' && /^\/issues\/\d+\/comments$/.test(c.path))

describe('tituloDaBackPromotion', () => {
  it('com tag: chore(release): back-promotion de vX.Y.Z', () => {
    expect(tituloDaBackPromotion({ tag: 'v1.2.4', sha: SHA })).toBe(
      'chore(release): back-promotion de v1.2.4'
    )
  })

  it('sem tag (release pulada): cai no sha7', () => {
    expect(tituloDaBackPromotion({ tag: null, sha: SHA })).toBe(
      'chore(release): back-promotion de abcdef1'
    )
  })
})

describe('corpoDaBackPromotion', () => {
  it('segue as seções do template de PR, com Spec n/a e a nota de merge commit', () => {
    const corpo = corpoDaBackPromotion({ esteira: ESTEIRA, tag: 'v1.2.4', sha: SHA })
    const template = readFileSync(resolve(ROOT, '.github/pull_request_template.md'), 'utf8')
    for (const secao of template.match(/^## .+$/gm) ?? []) expect(corpo).toContain(secao)
    expect(corpo.match(/^Spec:.*$/gm)).toEqual(['Spec: n/a — back-promotion'])
    expect(corpo).toContain('Create a merge commit')
    expect(corpo).toMatch(/nunca squash/i)
    // UAT é marcado só pelo humano ([R3]): nenhuma opção marcada.
    expect(corpo).toContain('- [ ] UAT aprovado')
    expect(corpo).toContain('- [ ] UAT não se aplica')
    expect(corpo).not.toMatch(/- \[x\]/i)
  })

  it('sem tag explica por que o título usa o SHA', () => {
    const corpo = corpoDaBackPromotion({ esteira: ESTEIRA, tag: null, sha: SHA })
    expect(corpo).toContain('abcdef1')
    expect(corpo).toMatch(/sem tag/i)
  })
})

describe('abrirBackPromotion — CT-ESTEIRA-013', () => {
  it('sem PR aberto: cria head producao → base integracao', async () => {
    const { github, chamadas, sleep } = cenario()
    const r = await abrirBackPromotion({ github, esteira: ESTEIRA, tag: 'v1.2.4', sha: SHA, sleep })
    expect(r).toEqual({ numero: 42, criado: true })
    const lista = chamadas.find((c) => c.method === 'GET' && c.path.startsWith('/pulls?'))
    expect(lista?.path).toContain('state=open')
    expect(lista?.path).toContain('base=develop')
    const post = chamadas.find((c) => c.method === 'POST' && c.path === '/pulls')
    expect(post?.body).toMatchObject({
      title: 'chore(release): back-promotion de v1.2.4',
      head: 'main',
      base: 'develop',
    })
    expect(String(post?.body?.body)).toContain('Spec: n/a — back-promotion')
    expect(comentarios(chamadas)).toHaveLength(0)
  })

  it('PR já aberto: atualiza o título e comenta, sem criar outro', async () => {
    const { github, chamadas, sleep } = cenario({ abertos: [aberto()] })
    const r = await abrirBackPromotion({ github, esteira: ESTEIRA, tag: 'v1.2.4', sha: SHA, sleep })
    expect(r).toEqual({ numero: 7, criado: false })
    expect(chamadas.some((c) => c.method === 'POST' && c.path === '/pulls')).toBe(false)
    const patch = chamadas.find((c) => c.method === 'PATCH' && c.path === '/pulls/7')
    expect(patch?.body).toEqual({ title: 'chore(release): back-promotion de v1.2.4' })
    const [comentario] = comentarios(chamadas)
    expect(comentario.path).toBe('/issues/7/comments')
    expect(String(comentario.body?.body)).toContain('v1.2.4')
  })

  it('idempotente: PR aberto já com o mesmo título → nada muda', async () => {
    const { github, chamadas, sleep } = cenario({
      abertos: [aberto({ title: 'chore(release): back-promotion de v1.2.4' })],
    })
    const r = await abrirBackPromotion({ github, esteira: ESTEIRA, tag: 'v1.2.4', sha: SHA, sleep })
    expect(r).toEqual({ numero: 7, criado: false })
    expect(chamadas.filter((c) => c.method !== 'GET')).toEqual([])
  })

  it('ignora PRs abertos de outra head ou de fork', async () => {
    const { github, chamadas, sleep } = cenario({
      abertos: [
        aberto({ number: 3, head: { ref: 'feature/x', repo: REPO } }),
        aberto({ number: 4, head: { ref: 'main', repo: { full_name: 'outro/fork' } } }),
        aberto({ number: 5, head: { ref: 'main', repo: null } }),
      ],
    })
    const r = await abrirBackPromotion({ github, esteira: ESTEIRA, tag: 'v1.2.4', sha: SHA, sleep })
    expect(r).toEqual({ numero: 42, criado: true })
    expect(chamadas.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('conflito (mergeable === false): comenta pedindo a resolução em backpromotion/*', async () => {
    const { github, chamadas, sleep } = cenario({ mergeable: [null, false] })
    await abrirBackPromotion({ github, esteira: ESTEIRA, tag: 'v1.2.4', sha: SHA, sleep })
    expect(sleep).toHaveBeenCalledTimes(1)
    const [comentario] = comentarios(chamadas)
    expect(comentario.path).toBe('/issues/42/comments')
    expect(String(comentario.body?.body)).toContain('backpromotion/')
    expect(String(comentario.body?.body)).toContain('develop')
  })

  it('mergeable ainda null após as tentativas: não comenta conflito', async () => {
    const { github, chamadas, sleep } = cenario({ mergeable: [null] })
    await abrirBackPromotion({ github, esteira: ESTEIRA, tag: 'v1.2.4', sha: SHA, sleep })
    expect(sleep).toHaveBeenCalled()
    expect(comentarios(chamadas)).toHaveLength(0)
  })

  it('sem tag: título pelo sha7', async () => {
    const { github, chamadas, sleep } = cenario()
    await abrirBackPromotion({ github, esteira: ESTEIRA, tag: null, sha: SHA, sleep })
    const post = chamadas.find((c) => c.method === 'POST' && c.path === '/pulls')
    expect(post?.body?.title).toBe('chore(release): back-promotion de abcdef1')
  })
})

describe('tagDoSha', () => {
  it('devolve a tag vX.Y.Z que aponta para o SHA (ou null)', async () => {
    const paginate = vi.fn(async () => [
      { name: 'v1.2.3', commit: { sha: 'f'.repeat(40) } },
      { name: 'outra', commit: { sha: SHA } },
      { name: 'v1.2.4', commit: { sha: SHA } },
    ])
    expect(await tagDoSha({ paginate }, SHA)).toBe('v1.2.4')
    expect(paginate).toHaveBeenCalledWith('/tags')
    expect(await tagDoSha({ paginate }, 'e'.repeat(40))).toBeNull()
  })
})
