import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const ler = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('workflow deploy.yml', () => {
  const yml = ler('.github/workflows/deploy.yml')

  it('dispara no PR (abrir, atualizar, reabrir, fechar) e no push na main', () => {
    expect(yml).toMatch(/pull_request:\n {4}types: \[opened, synchronize, reopened, closed\]/)
    expect(yml).toMatch(/push:\n {4}branches: \[main\]/)
  })

  it('permissões mínimas com id-token para o OIDC', () => {
    expect(yml).toContain('contents: read')
    expect(yml).toContain('deployments: write')
    expect(yml).toContain('id-token: write')
  })

  it('serializa por PR cancelando e a prod sem cancelar', () => {
    expect(yml).toContain("format('deploy-pr-{0}', github.event.pull_request.number)")
    expect(yml).toContain('deploy-prod')
    expect(yml).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
  })

  it('recusa PR de fork com aviso', () => {
    expect(yml).toContain('github.event.pull_request.head.repo.full_name != github.repository')
    expect(yml).toContain('::warning::')
  })

  it('passos google-github-actions só com host cloudrun', () => {
    const passos = yml.split(/\n {6}- /).filter((p) => p.includes('google-github-actions/'))
    expect(passos).toHaveLength(2)
    for (const p of passos) expect(p).toMatch(/if:[^\n]*== 'cloudrun'/)
    expect(yml).toContain('google-github-actions/auth@v2')
    expect(yml).toContain('google-github-actions/setup-gcloud@v2')
    expect(yml).toContain('configure-docker')
  })

  it('escolhe a operação pelo evento', () => {
    expect(yml).toContain('index.mjs host')
    expect(yml).toContain('index.mjs credenciais')
    expect(yml).toContain('index.mjs encerrar')
    expect(yml).toContain('index.mjs preview')
    expect(yml).toContain('index.mjs prod')
  })

  it('não imprime segredos', () => {
    expect(yml).not.toMatch(/echo[^\n]*secrets\./)
  })
})

describe('workflow e2e-regressao.yml', () => {
  const yml = ler('.github/workflows/e2e-regressao.yml')

  it('espera o preview pela CLI do deploy', () => {
    expect(yml).not.toContain('wait-preview.mjs')
    expect(yml).toContain('node scripts/deploy/index.mjs aguardar')
    expect(yml).toContain('DEPLOY_HOST: ${{ steps.host.outputs.host }}')
  })
})

describe('required checks', () => {
  it('Deploy não é check obrigatório', () => {
    expect(ler('hooks/protect-main/config.json')).not.toContain('Deploy')
  })
})
