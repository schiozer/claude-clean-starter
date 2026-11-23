import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const ler = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('workflow promover.yml', () => {
  const yml = ler('.github/workflows/promover.yml')

  it('nome "Promover para Prod" (bloqueado para o agente pelo protect-main)', () => {
    expect(yml).toMatch(/^name: Promover para Prod$/m)
  })

  it('só workflow_dispatch, sem inputs (o SHA vem do UAT, não de quem dispara)', () => {
    expect(yml).toMatch(/^on:\n {2}workflow_dispatch:\s*(\{\s*\})?\n/m)
    expect(yml).not.toContain('inputs:')
    expect(yml).not.toMatch(/^ {2}(push|pull_request|schedule|workflow_run):/m)
  })

  it('concurrency promover sem cancelar (Review Focus 2)', () => {
    expect(yml).toMatch(/concurrency:\n {2}group: promover\n {2}cancel-in-progress: false/)
  })

  it('environment production (segredos da App só aqui)', () => {
    expect(yml).toMatch(/^ {4}environment: production$/m)
  })

  it('gera o token da App esteira-promover e faz checkout completo com ele', () => {
    expect(yml).toContain('actions/create-github-app-token@v2')
    expect(yml).toContain('app-id: ${{ secrets.ESTEIRA_APP_ID }}')
    expect(yml).toContain('private-key: ${{ secrets.ESTEIRA_APP_PRIVATE_KEY }}')
    expect(yml).toMatch(/actions\/checkout@v5\n(\s+[^\n]*\n)*?\s+fetch-depth: 0/)
    expect(yml).toMatch(/token: \$\{\{ steps\.app\.outputs\.token \}\}/)
  })

  it('I-2: o token da App pede só contents, deployments e workflows (write)', () => {
    const passo = yml.split(/\n {6}- /).find((p) => p.includes('create-github-app-token'))
    expect(passo).toBeDefined()
    expect(passo).toMatch(/^ {10}permission-contents: write$/m)
    expect(passo).toMatch(/^ {10}permission-deployments: write$/m)
    expect(passo).toMatch(/^ {10}permission-workflows: write$/m)
    expect(passo?.match(/permission-/g)).toHaveLength(3)
  })

  it('I-3: o job com Environment production só roda a partir da main', () => {
    const [antes, job] = yml.split(/\n {2}promover:\n/)
    expect(job).toMatch(
      /^ {4}if: needs\.esteira\.outputs\.ativa == 'true' && github\.ref == 'refs\/heads\/main'$/m
    )
    // o 1º job (sem segredos) avisa por que não promove fora da main.
    expect(antes).toMatch(/if: github\.ref != 'refs\/heads\/main'/)
    expect(antes).toMatch(/::warning::[^\n]*refs\/heads\/main/)
  })

  it('vercel: instala o CLI fixado na major, só com host vercel', () => {
    const [antes, job] = yml.split(/\n {2}promover:\n/)
    expect(antes).toMatch(/^ {6}host: \$\{\{ steps\.host\.outputs\.host \}\}$/m)
    const passo = job.split(/\n {6}- /).find((p) => p.includes('npm i -g vercel@'))
    expect(passo).toBeDefined()
    expect(passo).toMatch(/npm i -g vercel@\d+\b/)
    expect(passo).not.toMatch(/vercel@latest/)
    expect(passo).toMatch(/if: needs\.esteira\.outputs\.host == 'vercel'/)
  })

  it('o token da App só vai para o checkout (FF por git); a API usa o token do job', () => {
    expect(yml.match(/steps\.app\.outputs\.token/g)).toHaveLength(1)
    expect(yml).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
  })

  it('setup-node 20 e roda o promover.mjs', () => {
    expect(yml).toContain('actions/setup-node@v5')
    expect(yml).toContain("node-version: '20'")
    expect(yml).toContain('node scripts/esteira/promover.mjs')
  })

  it('sai cedo com aviso sem esteira: o job da promoção (e os segredos) só roda com ela', () => {
    expect(yml).toContain('::warning::')
    expect(yml).toContain('node scripts/esteira/index.mjs ativa')
    const [antes, job] = yml.split(/\n {2}promover:\n/)
    expect(job).toBeDefined()
    // o job que lê a esteira não toca segredo nem Environment.
    expect(antes).not.toContain('secrets.')
    expect(antes).not.toContain('environment:')
    expect(job).toMatch(/^ {4}needs: esteira$/m)
    expect(job).toMatch(/^ {4}if: needs\.esteira\.outputs\.ativa == 'true'/m)
  })

  it('credenciais do host: Cloud Run de prod pelo OIDC e só com host cloudrun', () => {
    expect(yml).toContain('id-token: write')
    expect(yml).toContain('node scripts/deploy/index.mjs host')
    expect(yml).toContain('node scripts/deploy/index.mjs credenciais')
    expect(yml).toMatch(/DEPLOY_AMBIENTE: prod/)
    const passos = yml.split(/\n {6}- /).filter((p) => p.includes('google-github-actions/'))
    expect(passos).toHaveLength(2)
    for (const p of passos) expect(p).toMatch(/if:[^\n]*== 'cloudrun'/)
  })

  it('Heroku usa a chave de escrita; Vercel recebe as variáveis do rollback', () => {
    expect(yml).toMatch(/HEROKU_DEPLOY_API_KEY: \$\{\{[^\n]*secrets\.HEROKU_DEPLOY_API_KEY/)
    expect(yml).not.toMatch(/HEROKU_API_KEY:/)
    for (const v of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
      expect(yml).toContain(`${v}:`)
    }
  })

  it('permissões: contents/deployments/checks/issues, sem tudo-liberado', () => {
    for (const p of ['contents: write', 'deployments: write', 'checks: read', 'issues: write']) {
      expect(yml).toContain(p)
    }
    expect(yml).not.toContain('write-all')
  })

  it('nunca --force nem imprime segredos', () => {
    expect(yml).not.toContain('--force')
    expect(yml).not.toMatch(/echo[^\n]*(secrets\.|outputs\.token)/)
  })
})

describe('workflow back-promotion.yml', () => {
  const yml = ler('.github/workflows/back-promotion.yml')
  const [antes, job] = yml.split(/\n {2}abrir:\n/)

  it('dispara depois da Release concluída na main (a tag já existe)', () => {
    expect(ler('.github/workflows/release.yml')).toMatch(/^name: Release$/m)
    expect(yml).toMatch(
      /^on:\n {2}workflow_run:\n {4}workflows: \[Release\]\n {4}types: \[completed\]\n {4}branches: \[main\]\n/m
    )
    expect(yml).not.toMatch(/^ {2}(push|pull_request|pull_request_target):/m)
  })

  it('sem esteira sai cedo: o 1º job lê a esteira sem segredos nem Environment', () => {
    expect(antes).toContain('node scripts/esteira/index.mjs ativa')
    expect(antes).not.toContain('secrets.')
    expect(antes).not.toContain('environment:')
    expect(job).toMatch(/^ {4}needs: esteira$/m)
    expect(job).toMatch(/^ {4}if: needs\.esteira\.outputs\.ativa == 'true'$/m)
  })

  it('só com a Release verde e fora do FF da App esteira-promover', () => {
    const cond = /^ {4}if: (.+)$/m.exec(antes.split(/\n {2}esteira:\n/)[1] ?? '')?.[1] ?? ''
    expect(cond).toContain("github.event.workflow_run.conclusion == 'success'")
    expect(cond).toContain("github.event.workflow_run.actor.login != 'esteira-promover[bot]'")
    expect(cond).toContain("github.event.workflow_run.event == 'push'")
  })

  it('checkout do SHA da Release (não da main atual)', () => {
    expect(antes).toContain('ref: ${{ github.event.workflow_run.head_sha }}')
  })

  it('abre o PR com o token da App (dispara pr-gate/ci), escopo mínimo, Environment production', () => {
    expect(job).toMatch(/^ {4}environment: production$/m)
    expect(job).toContain('actions/create-github-app-token@v2')
    expect(job).toContain('app-id: ${{ secrets.ESTEIRA_APP_ID }}')
    expect(job).toContain('private-key: ${{ secrets.ESTEIRA_APP_PRIVATE_KEY }}')
    const passo = job.split(/\n {6}- /).find((p) => p.includes('create-github-app-token'))
    expect(passo).toMatch(/^ {10}permission-pull-requests: write$/m)
    expect(passo).toMatch(/^ {10}permission-contents: read$/m)
    expect(passo?.match(/permission-/g)).toHaveLength(2)
    expect(job).toContain('GITHUB_TOKEN: ${{ steps.app.outputs.token }}')
  })

  it('roda o backPromotion.mjs com o SHA da Release', () => {
    expect(job).toContain('node scripts/esteira/backPromotion.mjs')
    expect(job).toContain('BACKPROMOTION_SHA: ${{ github.event.workflow_run.head_sha }}')
  })

  it('permissões mínimas do GITHUB_TOKEN e nunca imprime segredos', () => {
    expect(yml).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(yml).not.toContain('write-all')
    expect(yml).not.toMatch(/echo[^\n]*(secrets\.|outputs\.token)/)
  })
})

describe('promover.yml usa a CLI da esteira no job sem segredos', () => {
  const yml = ler('.github/workflows/promover.yml')
  it('node scripts/esteira/index.mjs ativa', () => {
    const [antes] = yml.split(/\n {2}promover:\n/)
    expect(antes).toContain('node scripts/esteira/index.mjs ativa')
  })
})
