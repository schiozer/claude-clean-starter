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
  call: vi.fn(async (_m: string, path: string) => (path === '/deployments' ? { id: 77 } : {})),
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
