import { describe, it, expect, vi } from 'vitest'
import cloudrun, { imagem } from '../../scripts/deploy/hosts/cloudrun.mjs'

const amb = (p: string) => ({
  project: `app-${p}`,
  service: `svc-${p}`,
  wifProvider: `wif-${p}`,
  serviceAccount: `sa-${p}`,
})
const config = {
  host: 'cloudrun',
  cloudrun: { region: 'us-central1', repository: 'repo', uat: amb('uat'), prod: amb('prod') },
}
const SHA_A = 'aaaaaaa1111111111111111111111111111111111'
const SHA_B = 'bbbbbbb2222222222222222222222222222222222'
const LOCAL = ['--project', 'app-uat', '--region', 'us-central1']
const imgUat = (tag: string) => `us-central1-docker.pkg.dev/app-uat/repo/svc-uat:${tag}`
const imgProd = (tag: string) => `us-central1-docker.pkg.dev/app-prod/repo/svc-prod:${tag}`

const servicoJson = (traffic: object[]) => JSON.stringify({ status: { traffic } })
const URL_PR = 'https://pr-12---svc-uat-xyz.a.run.app'

function execPreview(json = servicoJson([{ tag: 'pr-12', url: URL_PR }, { percent: 100 }])) {
  return vi.fn(async (cmd: string, args: string[]) =>
    cmd === 'gcloud' && args.includes('--format=json') ? json : 'svc-uat\n'
  )
}
const githubFake = () => ({
  call: vi.fn<(method: string, path: string, body?: unknown) => Promise<object>>(
    async (_m, path) => (path === '/deployments' ? { id: 77 } : {})
  ),
  paginate: vi.fn(),
})
const ctxDe = (over: Record<string, unknown>) => ({
  config,
  pr: 12,
  sha: SHA_A,
  log: vi.fn(),
  github: githubFake(),
  ...over,
})

describe('cloudrun: contrato', () => {
  it('imagem monta o caminho do Artifact Registry', () =>
    expect(imagem(config.cloudrun, 'prod', 'main-abc1234')).toBe(imgProd('main-abc1234')))
  it('ambienteDePreview casa só "Preview"', () => {
    expect(cloudrun.ambienteDePreview('Preview')).toBe(true)
    expect(cloudrun.ambienteDePreview('Preview – app')).toBe(false)
    expect(cloudrun.nome).toBe('cloudrun')
  })
})

describe('cloudrun: deployPreview', () => {
  it('builda, publica revisão sem tráfego com tag pr-<n> e registra o Deployment', async () => {
    const exec = execPreview()
    const ctx = ctxDe({ exec })
    await cloudrun.deployPreview(ctx as never)
    const img = imgUat('pr-12-aaaaaaa')
    expect(exec.mock.calls).toEqual([
      [
        'gcloud',
        ['run', 'services', 'describe', 'svc-uat', ...LOCAL, '--format=value(metadata.name)'],
      ],
      ['docker', ['build', '-t', img, '.']],
      ['docker', ['push', img]],
      [
        'gcloud',
        ['run', 'deploy', 'svc-uat', '--image', img, ...LOCAL, '--tag', 'pr-12', '--no-traffic'],
      ],
      ['gcloud', ['run', 'services', 'describe', 'svc-uat', ...LOCAL, '--format=json']],
    ])
    expect(ctx.github.call.mock.calls).toEqual([
      [
        'POST',
        '/deployments',
        {
          ref: SHA_A,
          environment: 'Preview',
          auto_merge: false,
          required_contexts: [],
          transient_environment: true,
        },
      ],
      ['POST', '/deployments/77/statuses', { state: 'success', environment_url: URL_PR }],
    ])
  })

  it('push novo no mesmo PR: Deployment com o novo sha e imagem pr-12-<sha7>', async () => {
    const exec = execPreview()
    const ctx = ctxDe({ exec, sha: SHA_B })
    await cloudrun.deployPreview(ctx as never)
    expect(exec.mock.calls[2]).toEqual(['docker', ['push', imgUat('pr-12-bbbbbbb')]])
    expect(ctx.github.call.mock.calls[0][2]).toMatchObject({ ref: SHA_B })
  })

  it('serviço inexistente → erro apontando o Bootstrap e docker nunca chamado', async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd === 'gcloud') throw new Error("deploy: 'gcloud' falhou: NOT_FOUND")
      return ''
    })
    await expect(cloudrun.deployPreview(ctxDe({ exec }) as never)).rejects.toThrow(
      'Serviço svc-uat não existe em app-uat: rode o Bootstrap de docs/runbooks/host-cloudrun.md'
    )
    expect(exec.mock.calls.some(([cmd]) => cmd === 'docker')).toBe(false)
  })

  it('URL da tag ausente no JSON → erro e nenhum Deployment', async () => {
    const exec = execPreview(servicoJson([{ tag: 'pr-9', url: 'https://outro' }, { percent: 100 }]))
    const ctx = ctxDe({ exec })
    await expect(cloudrun.deployPreview(ctx as never)).rejects.toThrow('tag pr-12 sem URL')
    expect(ctx.github.call).not.toHaveBeenCalled()
  })

  it('sem cliente GitHub → erro claro', async () =>
    await expect(
      cloudrun.deployPreview(ctxDe({ exec: execPreview(), github: undefined }) as never)
    ).rejects.toThrow(/GITHUB_TOKEN/))
})

describe('cloudrun: deployProd', () => {
  it('builda main-<sha7>, faz deploy e move o tráfego para a última revisão', async () => {
    const exec = vi.fn(async () => '')
    await cloudrun.deployProd(ctxDe({ exec, pr: undefined }) as never)
    const img = imgProd('main-aaaaaaa')
    const local = ['--project', 'app-prod', '--region', 'us-central1']
    expect(exec.mock.calls).toEqual([
      ['docker', ['build', '-t', img, '.']],
      ['docker', ['push', img]],
      ['gcloud', ['run', 'deploy', 'svc-prod', '--image', img, ...local]],
      ['gcloud', ['run', 'services', 'update-traffic', 'svc-prod', '--to-latest', ...local]],
    ])
  })
})

describe('cloudrun: encerrarPreview', () => {
  const DESCRIBE_JSON = ['run', 'services', 'describe', 'svc-uat', ...LOCAL, '--format=json']
  const REMOVE = [
    'run',
    'services',
    'update-traffic',
    'svc-uat',
    '--remove-tags',
    'pr-12',
    ...LOCAL,
  ]

  it('tag presente: describe e depois remove só a tag do PR', async () => {
    const exec = execPreview()
    await cloudrun.encerrarPreview(ctxDe({ exec }) as never)
    expect(exec.mock.calls).toEqual([
      ['gcloud', DESCRIBE_JSON],
      ['gcloud', REMOVE],
    ])
  })

  it('tag ausente: log, sucesso e nenhum update-traffic', async () => {
    const exec = execPreview(servicoJson([{ tag: 'pr-9', url: 'https://outro' }, { percent: 100 }]))
    const ctx = ctxDe({ exec })
    await expect(cloudrun.encerrarPreview(ctx as never)).resolves.toBeUndefined()
    expect(exec.mock.calls).toEqual([['gcloud', DESCRIBE_JSON]])
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('pr-12'))
  })

  it("erro no describe (ex.: 'Project ... not found') → propaga", async () => {
    const exec = vi.fn(async () => {
      throw new Error("deploy: 'gcloud' falhou: Project 'app-uat' not found or permission denied")
    })
    await expect(cloudrun.encerrarPreview(ctxDe({ exec }) as never)).rejects.toThrow(
      /Project 'app-uat' not found/
    )
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('erro no update-traffic → propaga', async () => {
    const json = servicoJson([{ tag: 'pr-12', url: URL_PR }])
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes('--remove-tags')) {
        throw new Error("deploy: 'gcloud' falhou: Service 'svc-uat' not found")
      }
      return json
    })
    await expect(cloudrun.encerrarPreview(ctxDe({ exec }) as never)).rejects.toThrow(
      /Service 'svc-uat' not found/
    )
  })
})

describe('cloudrun: esteira (build once, promote)', () => {
  const DIGEST = 'sha256:' + 'd'.repeat(64)
  const LOCAL_PROD = ['--project', 'app-prod', '--region', 'us-central1']
  const REPO_UAT = 'us-central1-docker.pkg.dev/app-uat/repo/svc-uat'
  const URL_UAT = 'https://svc-uat-xyz.a.run.app'
  const prodJson = (traffic: object[], latestReady = 'svc-prod-00007-new') =>
    JSON.stringify({ status: { traffic, latestReadyRevisionName: latestReady } })

  type Respostas = Record<string, string | (() => string)>
  /** exec fake: responde pela 1ª chave cujo trecho aparece na linha de comando. */
  const execCom = (respostas: Respostas) =>
    vi.fn(async (cmd: string, args: string[]) => {
      const linha = [cmd, ...args].join(' ')
      for (const [trecho, saida] of Object.entries(respostas)) {
        if (linha.includes(trecho)) return typeof saida === 'function' ? saida() : saida
      }
      return ''
    })
  const githubUat = (deployments: object[]) => ({
    call: vi.fn(async (_m: string, path: string) => {
      if (path.startsWith('/deployments?environment=uat')) return deployments
      if (path.endsWith('/statuses?per_page=1')) return [{ state: 'success', environment_url: 'u' }]
      return []
    }),
  })
  const deployUatDe = (sha: string, payload: object = { digest: DIGEST }) => ({
    id: 5,
    sha,
    created_at: '2026-11-23T10:00:00Z',
    payload: { sha, ...payload },
  })

  it('promoveAposFF é false', () => expect(cloudrun.promoveAposFF).toBe(false))

  describe('deployUat', () => {
    it('builda develop-<sha7>, lê o digest, faz deploy por digest com 100% e devolve url + payload', async () => {
      const exec = execCom({
        'images describe': `${DIGEST}\n`,
        'value(status.url)': `${URL_UAT}\n`,
        'value(metadata.name)': 'svc-uat\n',
      })
      const r = await cloudrun.deployUat(ctxDe({ exec, pr: undefined }) as never)
      const img = imgUat('develop-aaaaaaa')
      expect(exec.mock.calls).toEqual([
        [
          'gcloud',
          ['run', 'services', 'describe', 'svc-uat', ...LOCAL, '--format=value(metadata.name)'],
        ],
        ['docker', ['build', '-t', img, '.']],
        ['docker', ['push', img]],
        [
          'gcloud',
          [
            'artifacts',
            'docker',
            'images',
            'describe',
            img,
            '--format=value(image_summary.digest)',
          ],
        ],
        ['gcloud', ['run', 'deploy', 'svc-uat', '--image', `${REPO_UAT}@${DIGEST}`, ...LOCAL]],
        ['gcloud', ['run', 'services', 'update-traffic', 'svc-uat', '--to-latest', ...LOCAL]],
        [
          'gcloud',
          ['run', 'services', 'describe', 'svc-uat', ...LOCAL, '--format=value(status.url)'],
        ],
      ])
      expect(r).toEqual({ url: URL_UAT, payload: { digest: DIGEST, imagem: img } })
    })

    it('digest fora do formato sha256 → erro e nenhum deploy', async () => {
      const exec = execCom({ 'images describe': 'latest\n' })
      await expect(cloudrun.deployUat(ctxDe({ exec }) as never)).rejects.toThrow(/digest/)
      expect(exec.mock.calls.some(([, a]) => a[0] === 'run' && a[1] === 'deploy')).toBe(false)
    })
  })

  it('urlUat lê status.url do serviço de UAT', async () => {
    const exec = execCom({ 'value(status.url)': `${URL_UAT}\n` })
    expect(await cloudrun.urlUat(ctxDe({ exec }) as never)).toBe(URL_UAT)
    expect(exec.mock.calls).toEqual([
      [
        'gcloud',
        ['run', 'services', 'describe', 'svc-uat', ...LOCAL, '--format=value(status.url)'],
      ],
    ])
  })

  describe('promoverProd (CT-ESTEIRA-011)', () => {
    it('deploy em prod pelo digest do UAT do SHA, sem docker build, e anota a revisão anterior', async () => {
      const exec = execCom({
        '--format=json': prodJson([{ revisionName: 'svc-prod-00006-old', percent: 100 }]),
      })
      const ctx = ctxDe({ exec, pr: undefined, github: githubUat([deployUatDe(SHA_A)]) })
      const r = await cloudrun.promoverProd(ctx as never)
      expect(exec.mock.calls).toEqual([
        ['gcloud', ['run', 'services', 'describe', 'svc-prod', ...LOCAL_PROD, '--format=json']],
        [
          'gcloud',
          ['run', 'deploy', 'svc-prod', '--image', `${REPO_UAT}@${DIGEST}`, ...LOCAL_PROD],
        ],
        ['gcloud', ['run', 'services', 'update-traffic', 'svc-prod', '--to-latest', ...LOCAL_PROD]],
      ])
      expect(exec.mock.calls.some(([cmd]) => cmd === 'docker')).toBe(false)
      expect(r).toEqual({
        payload: {
          digest: DIGEST,
          imagem: `${REPO_UAT}@${DIGEST}`,
          revisaoAnterior: 'svc-prod-00006-old',
        },
      })
    })

    it('tráfego em "latest" → revisão anterior = latestReadyRevisionName', async () => {
      const exec = execCom({
        '--format=json': prodJson([{ latestRevision: true, percent: 100 }], 'svc-prod-00005'),
      })
      const ctx = ctxDe({ exec, github: githubUat([deployUatDe(SHA_A)]) })
      const r = await cloudrun.promoverProd(ctx as never)
      expect(r.payload.revisaoAnterior).toBe('svc-prod-00005')
    })

    it('último deploy de UAT é de outro SHA → erro exato e nada executado', async () => {
      const exec = execCom({})
      const ctx = ctxDe({ exec, github: githubUat([deployUatDe(SHA_B)]) })
      await expect(cloudrun.promoverProd(ctx as never)).rejects.toThrow(
        'sem deploy de UAT para aaaaaaa'
      )
      expect(exec).not.toHaveBeenCalled()
    })

    it('sem deploy de UAT → erro exato', async () => {
      const ctx = ctxDe({ exec: execCom({}), github: githubUat([]) })
      await expect(cloudrun.promoverProd(ctx as never)).rejects.toThrow(
        'sem deploy de UAT para aaaaaaa'
      )
    })

    it('payload do UAT sem digest válido → erro e nada executado', async () => {
      const exec = execCom({})
      const ctx = ctxDe({ exec, github: githubUat([deployUatDe(SHA_A, { digest: 'latest' })]) })
      await expect(cloudrun.promoverProd(ctx as never)).rejects.toThrow(/digest/)
      expect(exec).not.toHaveBeenCalled()
    })
  })

  describe('rollbackProd', () => {
    const UPDATE = (rev: string) => [
      'gcloud',
      ['run', 'services', 'update-traffic', 'svc-prod', `--to-revisions=${rev}=100`, ...LOCAL_PROD],
    ]
    const pronta = (nome: string, quando: string, ok = 'True') => ({
      metadata: { name: nome, creationTimestamp: quando },
      status: { conditions: [{ type: 'Ready', status: ok }] },
    })

    it('com a revisão anotada no payload → volta 100% para ela', async () => {
      const exec = execCom({})
      await cloudrun.rollbackProd({
        ...ctxDe({ exec }),
        payload: { revisaoAnterior: 'svc-prod-00006-old' },
      } as never)
      expect(exec.mock.calls).toEqual([UPDATE('svc-prod-00006-old')])
    })

    it('sem anotação → a revisão pronta mais nova anterior à que serve 100%', async () => {
      const exec = execCom({
        'services describe': prodJson([{ revisionName: 'svc-prod-00007', percent: 100 }]),
        'revisions list': JSON.stringify([
          pronta('svc-prod-00005', '2026-11-20T10:00:00Z'),
          pronta('svc-prod-00007', '2026-11-23T10:00:00Z'),
          pronta('svc-prod-00006', '2026-11-22T10:00:00Z', 'False'),
          pronta('svc-prod-00004', '2026-11-19T10:00:00Z'),
        ]),
      })
      await cloudrun.rollbackProd(ctxDe({ exec }) as never)
      expect(exec.mock.calls.at(-2)).toEqual([
        'gcloud',
        ['run', 'revisions', 'list', '--service', 'svc-prod', ...LOCAL_PROD, '--format=json'],
      ])
      expect(exec.mock.calls.at(-1)).toEqual(UPDATE('svc-prod-00005'))
    })

    it('sem revisão anterior pronta → erro e nenhum update-traffic', async () => {
      const exec = execCom({
        'services describe': prodJson([{ revisionName: 'svc-prod-00001', percent: 100 }]),
        'revisions list': JSON.stringify([pronta('svc-prod-00001', '2026-11-20T10:00:00Z')]),
      })
      await expect(cloudrun.rollbackProd(ctxDe({ exec }) as never)).rejects.toThrow(
        /sem revisão anterior/
      )
      expect(exec.mock.calls.some(([, a]) => a.includes('update-traffic'))).toBe(false)
    })
  })

  it('sem esteira: deployProd (hotfix) segue buildando como hoje', async () => {
    const exec = vi.fn(async () => '')
    await cloudrun.deployProd(ctxDe({ exec, pr: undefined }) as never)
    expect(exec.mock.calls[0]).toEqual(['docker', ['build', '-t', imgProd('main-aaaaaaa'), '.']])
  })
})
