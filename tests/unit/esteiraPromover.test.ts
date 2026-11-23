import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  promover,
  makeGit,
  smokeHttp,
  executarPromocao,
  REGRESSAO_UAT,
  MARCA_REGRESSAO_UAT,
} from '../../scripts/esteira/promover.mjs'

const ROOT = resolve(__dirname, '../..')
const SHA = 'a'.repeat(40)
const SHA_VELHO = 'c'.repeat(40)
const MAIN = 'm'.repeat(40)
const HOTFIX = 'h'.repeat(40)
const ESTEIRA = {
  integracao: 'develop',
  producao: 'main',
  prefixoHotfix: 'hotfix/',
  promotores: ['fulano'],
}

type Chamada = { method: string; path: string; body?: Record<string, unknown> }
type Check = {
  name: string
  status: string
  conclusion: string | null
  id: number
  external_id?: string | null
}
const UAT = { name: 'Regressão (UAT)', external_id: 'esteira-uat' }

interface Opcoes {
  uat?: { id: number; sha: string; state: string; created_at: string }[]
  checks?: Check[]
  mains?: string[]
  ancestral?: boolean[]
  smokeOk?: boolean
  promoveAposFF?: boolean
  ffFalha?: boolean
  promoverFalha?: boolean
  /** promoverProd falha antes de mudar Prod (erro com `prodAlterada: false`). */
  promoverFalhaAntes?: boolean
  ultimaTag?: string | null
  urlProd?: string
  actor?: string
}

function cenario(o: Opcoes = {}) {
  const ordem: string[] = []
  const chamadas: Chamada[] = []
  const uat = o.uat ?? [{ id: 1, sha: SHA, state: 'success', created_at: '2026-11-20T10:00:00Z' }]
  const checks = o.checks ?? [{ ...UAT, status: 'completed', conclusion: 'success', id: 10 }]
  const github = {
    call: vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
      chamadas.push({ method, path, body })
      if (method === 'GET' && path.startsWith('/deployments?environment=uat')) {
        return uat.map((d) => ({ id: d.id, created_at: d.created_at, payload: { sha: d.sha } }))
      }
      const status = path.match(/^\/deployments\/(\d+)\/statuses/)
      if (method === 'GET' && status) {
        const d = uat.find((x) => x.id === Number(status[1]))
        return d ? [{ state: d.state, environment_url: 'https://uat.example' }] : []
      }
      if (method === 'GET' && path.startsWith(`/commits/${SHA}/check-runs`)) {
        return { check_runs: checks }
      }
      if (method === 'POST' && path === '/deployments') {
        ordem.push(`registrar:${body?.environment}`)
        return { id: 99 }
      }
      if (method === 'POST' && path === '/deployments/99/statuses') {
        ordem.push(`status:${body?.state}`)
        return {}
      }
      if (method === 'POST' && path === '/issues') {
        ordem.push('issue')
        return { number: 5 }
      }
      throw new Error(`chamada inesperada ${method} ${path}`)
    }),
  }
  const payloadProd = o.promoveAposFF
    ? { deploymentId: 7, url: 'https://prod.vercel.example' }
    : { digest: 'sha256:x', revisaoAnterior: 'svc-00001' }
  const adapter = {
    nome: o.promoveAposFF ? 'vercel' : 'cloudrun',
    promoveAposFF: o.promoveAposFF ?? false,
    promoverProd: vi.fn(async () => {
      ordem.push('promoverProd')
      if (o.promoverFalha) throw new Error('deploy de Production falhou')
      if (o.promoverFalhaAntes) {
        throw Object.assign(new Error('slug do UAT não é de abc1234'), { prodAlterada: false })
      }
      return { payload: payloadProd }
    }),
    rollbackProd: vi.fn(async () => {
      ordem.push('rollbackProd')
    }),
  }
  const mains = [...(o.mains ?? [MAIN, MAIN])]
  const ancestral = [...(o.ancestral ?? [true, true])]
  const git = {
    shaDe: vi.fn(async () => mains.shift() ?? MAIN),
    ehAncestral: vi.fn(async () => {
      ordem.push('ehAncestral')
      return ancestral.shift() ?? true
    }),
    ff: vi.fn(async () => {
      ordem.push('ff')
      if (o.ffFalha) throw new Error('push recusado: não é fast-forward')
    }),
    ultimaTag: vi.fn(async () => (o.ultimaTag === undefined ? 'v1.2.0' : o.ultimaTag)),
  }
  const smoke = vi.fn(async () => {
    ordem.push('smoke')
    return o.smokeOk ?? true
  })
  const release = vi.fn(async () => {
    ordem.push('release')
    return { tag: 'v1.3.0' }
  })
  const logs: string[] = []
  const args = {
    esteira: ESTEIRA,
    adapter,
    github,
    git,
    smoke,
    release,
    actor: o.actor ?? 'fulano',
    log: (m: string) => logs.push(m),
    ctx: { config: { host: adapter.nome }, env: {} },
    urlProd: 'urlProd' in o ? o.urlProd : 'https://prod.example',
  }
  return { args, ordem, chamadas, adapter, git, smoke, release, logs, github }
}

const semPromocao = (c: ReturnType<typeof cenario>) => {
  expect(c.adapter.promoverProd).not.toHaveBeenCalled()
  expect(c.git.ff).not.toHaveBeenCalled()
  expect(c.release).not.toHaveBeenCalled()
}

describe('promover (Heroku/Cloud Run: deploy antes do FF)', () => {
  it('caminho feliz: promove, registra production, smoke, FF e release, nessa ordem', async () => {
    const c = cenario()
    const r = await promover(c.args as never)
    expect(r).toEqual({ promovido: true, sha: SHA, tag: 'v1.3.0' })
    expect(c.ordem).toEqual([
      'ehAncestral',
      'promoverProd',
      'registrar:production',
      'status:success',
      'smoke',
      'ehAncestral',
      'ff',
      'release',
    ])
    const registro = c.chamadas.find((x) => x.method === 'POST' && x.path === '/deployments')
    expect(registro?.body).toMatchObject({
      ref: SHA,
      environment: 'production',
      payload: { sha: SHA, digest: 'sha256:x' },
    })
    expect(c.git.ff).toHaveBeenCalledWith(SHA)
    expect(c.git.ehAncestral).toHaveBeenCalledWith(MAIN, SHA)
    expect(c.smoke).toHaveBeenCalledWith('https://prod.example')
    expect(c.release).toHaveBeenCalledWith({ de: 'v1.2.0', ate: SHA })
    expect(c.git.ultimaTag).toHaveBeenCalledWith(MAIN)
  })

  it('o ctx do adapter leva o SHA do UAT e a esteira', async () => {
    const c = cenario()
    await promover(c.args as never)
    expect(c.adapter.promoverProd).toHaveBeenCalledWith(
      expect.objectContaining({ sha: SHA, esteira: ESTEIRA, config: { host: 'cloudrun' } })
    )
  })

  it('sem tag alcançável pela main: release a partir do SHA da main antes do FF', async () => {
    const c = cenario({ ultimaTag: null })
    await promover(c.args as never)
    expect(c.release).toHaveBeenCalledWith({ de: MAIN, ate: SHA })
  })

  it('actor fora de promotores → erro sem tocar adapter, git nem GitHub', async () => {
    const c = cenario({ actor: 'intruso' })
    await expect(promover(c.args as never)).rejects.toThrow(
      'promover: intruso não está em esteira.promotores'
    )
    semPromocao(c)
    expect(c.github.call).not.toHaveBeenCalled()
    expect(c.git.shaDe).not.toHaveBeenCalled()
  })

  it('sem deploy de UAT bem-sucedido → erro', async () => {
    const c = cenario({
      uat: [{ id: 1, sha: SHA, state: 'failure', created_at: '2026-11-20T10:00:00Z' }],
    })
    await expect(promover(c.args as never)).rejects.toThrow(/sem deploy de UAT bem-sucedido/)
    semPromocao(c)
  })

  it('Review Focus 3: usa o último uat com success, nunca o mais novo com failure', async () => {
    const c = cenario({
      uat: [
        { id: 2, sha: SHA_VELHO, state: 'failure', created_at: '2026-11-21T10:00:00Z' },
        { id: 1, sha: SHA, state: 'success', created_at: '2026-11-20T10:00:00Z' },
      ],
    })
    const r = await promover(c.args as never)
    expect(r.sha).toBe(SHA)
    expect(c.git.ff).toHaveBeenCalledWith(SHA)
  })

  it('CT-ESTEIRA-007: Regressão (UAT) vermelha para o SHA → recusa', async () => {
    const c = cenario({
      checks: [{ ...UAT, status: 'completed', conclusion: 'failure', id: 10 }],
    })
    await expect(promover(c.args as never)).rejects.toThrow(
      `Regressão (UAT) não está verde para ${SHA.slice(0, 7)}`
    )
    semPromocao(c)
  })

  it('CT-ESTEIRA-007: Regressão (UAT) ausente ou em andamento → recusa', async () => {
    const casos: Check[][] = [
      [],
      [{ name: 'Outro', status: 'completed', conclusion: 'success', id: 1 }],
      [{ ...UAT, status: 'in_progress', conclusion: null, id: 2 }],
    ]
    for (const checks of casos) {
      const c = cenario({ checks })
      await expect(promover(c.args as never)).rejects.toThrow(/Regressão \(UAT\) não está verde/)
      semPromocao(c)
    }
  })

  it('CT-ESTEIRA-007: vale o run mais recente da Regressão (re-run verde depois do vermelho)', async () => {
    const c = cenario({
      checks: [
        { ...UAT, status: 'completed', conclusion: 'failure', id: 10 },
        { ...UAT, status: 'completed', conclusion: 'success', id: 11 },
      ],
    })
    expect((await promover(c.args as never)).promovido).toBe(true)
  })

  it('marca da regressão de UAT: o check publicado pelo deploy.yml (external_id esteira-uat)', () => {
    expect(MARCA_REGRESSAO_UAT).toBe('esteira-uat')
    expect(UAT.external_id).toBe(MARCA_REGRESSAO_UAT)
  })

  it('colisão: Regressão (UAT) do PR verde (sem marca) mais recente que a de UAT vermelha → recusa', async () => {
    const c = cenario({
      checks: [
        { ...UAT, status: 'completed', conclusion: 'failure', id: 10 },
        { name: REGRESSAO_UAT, status: 'completed', conclusion: 'success', id: 11 },
      ],
    })
    await expect(promover(c.args as never)).rejects.toThrow(/Regressão \(UAT\) não está verde/)
    semPromocao(c)
  })

  it('colisão: Regressão (UAT) do PR vermelha (sem marca) mais recente que a de UAT verde → promove', async () => {
    const c = cenario({
      checks: [
        { ...UAT, status: 'completed', conclusion: 'success', id: 10 },
        {
          name: REGRESSAO_UAT,
          status: 'completed',
          conclusion: 'failure',
          id: 11,
          external_id: null,
        },
      ],
    })
    expect((await promover(c.args as never)).promovido).toBe(true)
  })

  it('só a Regressão (UAT) do PR (sem marca), mesmo verde → recusa como ausente', async () => {
    const c = cenario({
      checks: [{ name: REGRESSAO_UAT, status: 'completed', conclusion: 'success', id: 11 }],
    })
    await expect(promover(c.args as never)).rejects.toThrow(
      `Regressão (UAT) não está verde para ${SHA.slice(0, 7)} (ausente)`
    )
    semPromocao(c)
  })

  it('consulta o check pelo nome exato no SHA do UAT', async () => {
    const c = cenario()
    await promover(c.args as never)
    const consulta = c.chamadas.find((x) => x.path.includes('/check-runs'))
    expect(consulta?.path).toContain(`/commits/${SHA}/check-runs`)
    expect(consulta?.path).toContain(`check_name=${encodeURIComponent('Regressão (UAT)')}`)
  })

  it('Review Focus 2: main já no SHA → no-op com aviso, sem tag', async () => {
    const c = cenario({ mains: [SHA] })
    const r = await promover(c.args as never)
    expect(r).toEqual({ promovido: false, sha: SHA })
    semPromocao(c)
    expect(c.logs.join('\n')).toMatch(/já está em .*nada a promover/)
  })

  it('CT-ESTEIRA-006: main não é ancestral do SHA → recusa com a mensagem de back-promotion', async () => {
    const c = cenario({ ancestral: [false] })
    await expect(promover(c.args as never)).rejects.toThrow(
      'há back-promotion pendente: mergeie o PR main → develop e aguarde o novo deploy de UAT'
    )
    semPromocao(c)
  })

  it('CT-ESTEIRA-008: smoke falho → rollbackProd, deployment failure e main NÃO avança', async () => {
    const c = cenario({ smokeOk: false })
    await expect(promover(c.args as never)).rejects.toThrow(/smoke test em Prod falhou/)
    expect(c.adapter.rollbackProd).toHaveBeenCalledTimes(1)
    expect(c.git.ff).not.toHaveBeenCalled()
    expect(c.release).not.toHaveBeenCalled()
    expect(c.ordem).toContain('status:failure')
    // o payload do promoverProd (revisaoAnterior do Cloud Run) chega ao rollback.
    expect(c.adapter.rollbackProd).toHaveBeenCalledWith(
      expect.objectContaining({
        sha: SHA,
        payload: expect.objectContaining({ revisaoAnterior: 'svc-00001' }),
      })
    )
  })

  it('rollback que também falha: erro cita os dois motivos e marca failure', async () => {
    const c = cenario({ smokeOk: false })
    c.adapter.rollbackProd.mockRejectedValueOnce(new Error('sem revisão anterior'))
    await expect(promover(c.args as never)).rejects.toThrow(
      /smoke test em Prod falhou.*rollback também falhou: sem revisão anterior — verifique Prod manualmente/
    )
    expect(c.ordem).toContain('status:failure')
    expect(c.git.ff).not.toHaveBeenCalled()
  })

  it('Review Focus 5: main mudou durante a promoção → rollback e erro, sem FF', async () => {
    const c = cenario({ ancestral: [true, false], mains: [MAIN, HOTFIX] })
    await expect(promover(c.args as never)).rejects.toThrow(
      'a main mudou durante a promoção (hotfix?)'
    )
    expect(c.adapter.rollbackProd).toHaveBeenCalledTimes(1)
    expect(c.ordem).toContain('status:failure')
    expect(c.git.ff).not.toHaveBeenCalled()
    expect(c.git.ehAncestral).toHaveBeenLastCalledWith(HOTFIX, SHA)
  })

  it('FF recusado → rollback, deployment failure e erro', async () => {
    const c = cenario({ ffFalha: true })
    await expect(promover(c.args as never)).rejects.toThrow(/fast-forward/)
    expect(c.adapter.rollbackProd).toHaveBeenCalledTimes(1)
    expect(c.ordem).toContain('status:failure')
    expect(c.release).not.toHaveBeenCalled()
  })

  it('I-1: promoverProd que falha depois de mexer em Prod → rollback, erro com o motivo, sem FF', async () => {
    const c = cenario({ promoverFalha: true })
    await expect(promover(c.args as never)).rejects.toThrow('promover: deploy de Production falhou')
    expect(c.adapter.rollbackProd).toHaveBeenCalledTimes(1)
    // sem payload do promoverProd: o rollback recebe o ctx com payload vazio.
    expect(c.adapter.rollbackProd).toHaveBeenCalledWith(
      expect.objectContaining({ sha: SHA, payload: {} })
    )
    expect(c.git.ff).not.toHaveBeenCalled()
    expect(c.release).not.toHaveBeenCalled()
    expect(c.ordem).not.toContain('registrar:production')
  })

  it('I-2: promoverProd falha antes de mudar Prod → sem rollback, erro original, sem FF', async () => {
    const c = cenario({ promoverFalhaAntes: true })
    await expect(promover(c.args as never)).rejects.toThrow(
      'promover: slug do UAT não é de abc1234 (Prod não foi alterada: sem rollback)'
    )
    expect(c.adapter.rollbackProd).not.toHaveBeenCalled()
    expect(c.git.ff).not.toHaveBeenCalled()
    expect(c.release).not.toHaveBeenCalled()
    // o Deployment production só é registrado depois do promoverProd: nada a marcar.
    expect(c.ordem).not.toContain('registrar:production')
  })

  it('I-1: promoverProd e rollback falham → erro manda verificar Prod manualmente', async () => {
    const c = cenario({ promoverFalha: true })
    c.adapter.rollbackProd.mockRejectedValueOnce(new Error('sem release anterior'))
    await expect(promover(c.args as never)).rejects.toThrow(
      /deploy de Production falhou; rollback também falhou: sem release anterior — verifique Prod manualmente/
    )
    expect(c.git.ff).not.toHaveBeenCalled()
  })

  it('sem URL de Prod para o smoke → erro antes de promover', async () => {
    const c = cenario({ urlProd: undefined })
    await expect(promover(c.args as never)).rejects.toThrow(/PROD_URL/)
    semPromocao(c)
  })
})

describe('promover (Vercel: promoveAposFF)', () => {
  it('ordem: checagens → registrar production → FF → promoverProd → smoke → release', async () => {
    const c = cenario({ promoveAposFF: true, urlProd: undefined })
    const r = await promover(c.args as never)
    expect(r).toEqual({ promovido: true, sha: SHA, tag: 'v1.3.0' })
    // o Deployment `production` sai antes do FF: a Guarda só aceita o FF da App com ele.
    expect(c.ordem).toEqual([
      'ehAncestral',
      'registrar:production',
      'status:success',
      'ff',
      'promoverProd',
      'status:success',
      'smoke',
      'release',
    ])
    // sem PROD_URL, o smoke usa a URL do deploy de Production.
    expect(c.smoke).toHaveBeenCalledWith('https://prod.vercel.example')
  })

  it('smoke falho → rollback, failure, issue esteira "main à frente de Prod" e erro', async () => {
    const c = cenario({ promoveAposFF: true, smokeOk: false })
    await expect(promover(c.args as never)).rejects.toThrow(/smoke test em Prod falhou/)
    expect(c.adapter.rollbackProd).toHaveBeenCalledTimes(1)
    expect(c.ordem).toContain('status:failure')
    const issue = c.chamadas.find((x) => x.path === '/issues')
    expect(issue?.body?.labels).toEqual(['esteira'])
    expect(String(issue?.body?.title)).toContain('main à frente de Prod')
    expect(c.release).not.toHaveBeenCalled()
  })

  it('I-1: deploy de Production que falha depois do FF → rollback, failure, issue e erro', async () => {
    const c = cenario({ promoveAposFF: true, promoverFalha: true })
    await expect(promover(c.args as never)).rejects.toThrow('promover: deploy de Production falhou')
    expect(c.adapter.rollbackProd).toHaveBeenCalledTimes(1)
    expect(c.adapter.rollbackProd).toHaveBeenCalledWith(expect.objectContaining({ payload: {} }))
    expect(c.ordem).toContain('status:failure')
    expect(c.ordem).toContain('issue')
    expect(c.smoke).not.toHaveBeenCalled()
    expect(c.release).not.toHaveBeenCalled()
  })

  it('I-2: promoverProd sinaliza Prod intocada → sem rollback, mas failure, issue e erro', async () => {
    const c = cenario({ promoveAposFF: true, promoverFalhaAntes: true })
    await expect(promover(c.args as never)).rejects.toThrow(
      /slug do UAT não é de abc1234 \(Prod não foi alterada: sem rollback\)/
    )
    expect(c.adapter.rollbackProd).not.toHaveBeenCalled()
    expect(c.ordem).toContain('status:failure')
    expect(c.ordem).toContain('issue')
  })

  it('I-1: deploy de Production e rollback falham → erro manda verificar Prod manualmente', async () => {
    const c = cenario({ promoveAposFF: true, promoverFalha: true })
    c.adapter.rollbackProd.mockRejectedValueOnce(new Error('VERCEL_TOKEN ausente'))
    await expect(promover(c.args as never)).rejects.toThrow(
      /rollback também falhou: VERCEL_TOKEN ausente — verifique Prod manualmente/
    )
    expect(c.ordem).toContain('issue')
  })

  it('FF recusado → deployment failure, sem rollback (Prod não mudou)', async () => {
    const c = cenario({ promoveAposFF: true, ffFalha: true })
    await expect(promover(c.args as never)).rejects.toThrow(/fast-forward/)
    expect(c.ordem).toContain('status:failure')
    expect(c.adapter.promoverProd).not.toHaveBeenCalled()
    expect(c.adapter.rollbackProd).not.toHaveBeenCalled()
  })

  it('back-promotion pendente → recusa antes do FF', async () => {
    const c = cenario({ promoveAposFF: true, ancestral: [false] })
    await expect(promover(c.args as never)).rejects.toThrow(/há back-promotion pendente/)
    semPromocao(c)
  })
})

describe('makeGit', () => {
  const comRunner = (impl: (cmd: string, args: string[]) => Promise<string>) => {
    const rodar = vi.fn(impl)
    return { rodar, git: makeGit({ rodar, producao: 'main' }) }
  }
  const falhaCom = (code: number, mensagem = 'x') =>
    comRunner(async () => {
      throw Object.assign(new Error(mensagem), { code })
    })

  it('ff = push do SHA para refs/heads/<producao>, sem --force', async () => {
    const { rodar, git } = comRunner(async () => '')
    await git.ff(SHA)
    expect(rodar).toHaveBeenCalledWith('git', ['push', 'origin', `${SHA}:refs/heads/main`])
    for (const [, args] of rodar.mock.calls) {
      expect(args.join(' ')).not.toMatch(/--force|\s-f\b|\+/)
    }
  })

  it('shaDe busca a branch e lê origin/<branch>', async () => {
    const { rodar, git } = comRunner(async (_c, args) =>
      args[0] === 'rev-parse' ? `${MAIN}\n` : ''
    )
    expect(await git.shaDe('main')).toBe(MAIN)
    expect(rodar).toHaveBeenCalledWith('git', ['fetch', 'origin', 'main'])
    expect(rodar).toHaveBeenCalledWith('git', ['rev-parse', 'origin/main'])
  })

  it('ehAncestral: exit 0 → true, exit 1 → false, outro erro → lança', async () => {
    expect(await comRunner(async () => '').git.ehAncestral(MAIN, SHA)).toBe(true)
    const naoAncestral = falhaCom(1)
    expect(await naoAncestral.git.ehAncestral(MAIN, SHA)).toBe(false)
    expect(naoAncestral.rodar).toHaveBeenCalledWith('git', [
      'merge-base',
      '--is-ancestor',
      MAIN,
      SHA,
    ])
    await expect(falhaCom(128, 'fatal: objeto ausente').git.ehAncestral(MAIN, SHA)).rejects.toThrow(
      /objeto ausente/
    )
  })

  it('ultimaTag: tag vX.Y.Z alcançável ou null', async () => {
    const comTag = comRunner(async () => 'v1.2.0\n')
    expect(await comTag.git.ultimaTag(MAIN)).toBe('v1.2.0')
    expect(comTag.rodar.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['describe', '--tags', '--abbrev=0', MAIN])
    )
    expect(await falhaCom(128, 'No names found').git.ultimaTag(MAIN)).toBeNull()
  })
})

describe('smokeHttp', () => {
  const semEspera = async () => {}
  it('2xx → true na primeira tentativa', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }))
    const smoke = smokeHttp({ fetchFn: fetchFn as never, sleep: semEspera })
    expect(await smoke('https://p')).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
  it('falha em todas as tentativas → false', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 503 }))
    const smoke = smokeHttp({ fetchFn: fetchFn as never, sleep: semEspera, tentativas: 3 })
    expect(await smoke('https://p')).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })
  it('erro de rede conta como falha e tenta de novo', async () => {
    let n = 0
    const fetchFn = vi.fn(async () => {
      if (n++ === 0) throw new Error('ECONNRESET')
      return { ok: true, status: 200 }
    })
    const smoke = smokeHttp({ fetchFn: fetchFn as never, sleep: semEspera, tentativas: 3 })
    expect(await smoke('https://p')).toBe(true)
  })
})

describe('executarPromocao', () => {
  const dirs: string[] = []
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
  const raizCom = (config: object) => {
    const dir = mkdtempSync(join(tmpdir(), 'promover-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'hooks/protect-main'), { recursive: true })
    writeFileSync(join(dir, 'hooks/protect-main/config.json'), JSON.stringify(config))
    return dir
  }

  it('sem esteira → não promove e avisa (como hoje)', async () => {
    const logs: string[] = []
    const r = await executarPromocao({
      raiz: raizCom({ protectedBranches: ['main'] }),
      env: {},
      log: (m: string) => logs.push(m),
    })
    expect(r).toEqual({ promovido: false })
    expect(logs.join('\n')).toMatch(/esteira desligada/)
  })

  it('com esteira, valida o deploy.config para a esteira', async () => {
    const raiz = raizCom({ protectedBranches: ['main'], esteira: ESTEIRA })
    writeFileSync(
      join(raiz, 'deploy.config.json'),
      JSON.stringify({ host: 'heroku', heroku: { pipelineId: 'p' } })
    )
    await expect(
      executarPromocao({ raiz, env: { GITHUB_ACTOR: 'fulano' }, log: () => {} })
    ).rejects.toThrow(/heroku.uatApp obrigatório com a esteira/)
  })

  it('com esteira e sem GITHUB_TOKEN → erro claro', async () => {
    const raiz = raizCom({ protectedBranches: ['main'], esteira: ESTEIRA })
    writeFileSync(
      join(raiz, 'deploy.config.json'),
      JSON.stringify({ host: 'vercel', vercel: { uatAlias: 'uat.example', team: 't' } })
    )
    await expect(
      executarPromocao({ raiz, env: { GITHUB_ACTOR: 'fulano' }, log: () => {} })
    ).rejects.toThrow('promover: GITHUB_TOKEN e GITHUB_REPOSITORY são obrigatórios')
  })
})

describe('promover.mjs: fonte', () => {
  it('nunca usa --force', () => {
    expect(readFileSync(resolve(ROOT, 'scripts/esteira/promover.mjs'), 'utf8')).not.toContain(
      '--force'
    )
  })
})
