import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const ler = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('workflow deploy.yml', () => {
  const yml = ler('.github/workflows/deploy.yml')

  it('dispara no PR (abrir, atualizar, reabrir, fechar) e no push na main e na develop', () => {
    expect(yml).toMatch(/pull_request:\n {4}types: \[opened, synchronize, reopened, closed\]/)
    // develop fixo: workflow não lê config (o runbook de adoção da esteira cobre outro nome).
    expect(yml).toMatch(/push:\n(\s+#[^\n]*\n)*\s+branches: \[main, develop\]/)
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

describe('deploy.yml com a esteira', () => {
  const yml = ler('.github/workflows/deploy.yml')
  const [deployJob] = yml.split(/\n {2}regressao-uat:\n/)
  const passos = deployJob.split(/\n {6}- /).slice(1)
  const passo = (nome: string) => {
    const achado = passos.find((p) => p.startsWith(`name: ${nome}\n`))
    expect(achado, nome).toBeDefined()
    return achado ?? ''
  }
  const seDe = (p: string) => /^ {8}if: (.+)$/m.exec(p)?.[1] ?? ''

  it('lê a esteira pela CLI (sem segredos) só no push', () => {
    const p = passo('Esteira')
    expect(p).toContain('id: esteira')
    expect(p).toContain('node scripts/esteira/index.mjs ativa')
    expect(seDe(p)).toContain("github.event_name == 'push'")
    expect(p).not.toContain('secrets.')
  })

  it('escolhe a operação: PR, sem esteira (só a main), UAT, FF da App (no-op) e hotfix', () => {
    const p = passo('Escolher a operação')
    expect(p).toContain('id: op')
    expect(p).toContain('ATIVA: ${{ steps.esteira.outputs.ativa }}')
    expect(p).toContain('INTEGRACAO: ${{ steps.esteira.outputs.integracao }}')
    expect(p).toContain('PRODUCAO: ${{ steps.esteira.outputs.producao }}')
    expect(p).toContain('SENDER: ${{ github.event.sender.login }}')
    expect(p).toContain("'esteira-promover[bot]'")
    for (const op of ['preview', 'encerrar', 'prod', 'uat', 'hotfix', 'nenhuma']) {
      expect(p).toContain(`operacao=${op}`)
    }
  })

  it('sem esteira: push na main → index.mjs prod como hoje (sem a chave de escrita)', () => {
    const p = passo('Deploy de produção')
    expect(seDe(p)).toContain("steps.op.outputs.operacao == 'prod'")
    expect(p).toContain('node scripts/deploy/index.mjs prod')
    expect(p).not.toContain('HEROKU_DEPLOY_API_KEY')
  })

  it('push na integração com esteira → index.mjs uat, com a URL como output do job', () => {
    const p = passo('Deploy de UAT (esteira)')
    expect(p).toContain('id: uat')
    expect(seDe(p)).toContain("steps.op.outputs.operacao == 'uat'")
    expect(p).toContain('node scripts/deploy/index.mjs uat')
    expect(p).toContain('DEPLOY_SHA: ${{ github.sha }}')
    expect(deployJob).toMatch(/outputs:\n {6}operacao: \$\{\{ steps\.op\.outputs\.operacao \}\}/)
    expect(deployJob).toMatch(/ {6}url: \$\{\{ steps\.uat\.outputs\.url \}\}/)
  })

  it('push na produção fora do FF da App → hotfix pelo index.mjs prod', () => {
    const p = passo('Deploy do hotfix (esteira)')
    expect(seDe(p)).toContain("steps.op.outputs.operacao == 'hotfix'")
    expect(p).toContain('node scripts/deploy/index.mjs prod')
  })

  it('FF da App esteira-promover não redeploya (só avisa)', () => {
    const op = passo('Escolher a operação')
    expect(op).toMatch(/SENDER" = 'esteira-promover\[bot\]'[^\n]*\n[^\n]*operacao=nenhuma/)
    expect(op).toMatch(/::notice::/)
  })

  it('HEROKU_DEPLOY_API_KEY só em passos de push, nunca no caminho de pull_request', () => {
    const comChave = passos.filter((p) => p.includes('HEROKU_DEPLOY_API_KEY'))
    expect(comChave.length).toBe(2)
    for (const p of comChave) {
      expect(seDe(p)).toContain("github.event_name == 'push'")
      expect(seDe(p)).not.toContain('pull_request')
      expect(p).toMatch(/HEROKU_DEPLOY_API_KEY: \$\{\{ steps\.host\.outputs\.host == 'heroku' &&/)
    }
    for (const p of passos.filter((x) => seDe(x).includes("'pull_request'"))) {
      expect(p).not.toContain('HEROKU_DEPLOY_API_KEY')
    }
    expect(ler('.github/workflows/e2e-regressao.yml')).not.toContain('HEROKU_DEPLOY_API_KEY')
  })

  it('Cloud Run: credenciais de uat no PR e no deploy de UAT; nada com operação nenhuma', () => {
    const p = passo('Credenciais do Cloud Run')
    expect(seDe(p)).toContain("steps.op.outputs.operacao != 'nenhuma'")
    expect(p).toMatch(/DEPLOY_AMBIENTE: \$\{\{[^\n]*'uat'[^\n]*'uat' \|\| 'prod' \}\}/)
  })

  it('concorrência: prod e UAT serializados sem cancelar', () => {
    expect(yml).toContain("'deploy-uat'")
    expect(yml).toContain("'deploy-prod'")
  })

  it('Regressão contra o UAT: chama o e2e-regressao.yml reutilizável depois do deploy de UAT', () => {
    const [, job] = yml.split(/\n {2}regressao-uat:\n/)
    expect(job).toBeDefined()
    const bloco = job.split(/\n {2}[a-z-]+:\n/)[0]
    expect(bloco).toMatch(/^ {4}needs: deploy$/m)
    expect(bloco).toContain('uses: ./.github/workflows/e2e-regressao.yml')
    expect(bloco).toContain('alvo: ${{ needs.deploy.outputs.url }}')
    expect(bloco).toContain('secrets: inherit')
    // o reutilizável pede pull-requests: write; o chamador precisa conceder.
    expect(bloco).toMatch(
      /permissions:\n {6}contents: read\n {6}deployments: read\n {6}pull-requests: write/
    )
  })

  it('publica o check "Regressão (UAT)" no SHA da develop pela API (nome exato do promover)', () => {
    // Um job chamado "Regressão (UAT)" aqui viraria check "skipped" no SHA de todo PR (este
    // workflow roda em pull_request) e mascararia o check obrigatório: o check sai pela API, só
    // quando o job roda. O do reutilizável sai como "<job> / Regressão (UAT)", sem colidir.
    const [, job] = yml.split(/\n {2}publicar-regressao-uat:\n/)
    expect(job).toBeDefined()
    expect(job).not.toMatch(/^ {4}name: Regressão \(UAT\)$/m)
    expect(job).toMatch(/^ {4}needs: \[deploy, regressao-uat\]$/m)
    expect(job).toMatch(/permissions:\n {6}checks: write\n/)
    expect(job).toContain('/check-runs')
    expect(job).toContain("-f name='Regressão (UAT)'")
    expect(job).toContain('-f head_sha="$GITHUB_SHA"')
    expect(job).toContain('-f status=completed')
    // marca que o promover exige: a Regressão (UAT) do PR (mesmo nome) não vale como veredito.
    expect(job).toContain("-f external_id='esteira-uat'")
    expect(job).toContain(
      "CONCLUSAO: ${{ needs.regressao-uat.result == 'success' && 'success' || 'failure' }}"
    )
    expect(job).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
  })

  it('o veredito de UAT nunca vem de run local: sem URL do UAT, nada roda nem é publicado', () => {
    const [, resto] = yml.split(/\n {2}regressao-uat:\n/)
    const regressao = resto.split(/\n {2}[a-z-]+:\n/)[0]
    expect(regressao).toMatch(
      /^ {4}if: needs\.deploy\.outputs\.operacao == 'uat' && needs\.deploy\.outputs\.url != ''$/m
    )
    const [, publicar] = yml.split(/\n {2}publicar-regressao-uat:\n/)
    expect(publicar).toMatch(
      /^ {4}if: always\(\) && needs\.deploy\.result == 'success' && needs\.deploy\.outputs\.operacao == 'uat' && needs\.deploy\.outputs\.url != ''$/m
    )
  })

  it('nenhum job do deploy.yml se chama "Regressão (UAT)" (evita check skipped no PR)', () => {
    expect(yml).not.toMatch(/^ {4}name: Regressão \(UAT\)$/m)
  })
})

describe('workflow e2e-regressao.yml', () => {
  const yml = ler('.github/workflows/e2e-regressao.yml')
  const passos = yml.split(/\n {6}- /).slice(1)
  const passo = (nome: string) => passos.find((p) => p.startsWith(`name: ${nome}\n`)) ?? ''

  it('espera o preview pela CLI do deploy', () => {
    expect(yml).not.toContain('wait-preview.mjs')
    expect(yml).toContain('node scripts/deploy/index.mjs aguardar')
    expect(yml).toContain('DEPLOY_HOST: ${{ steps.host.outputs.host }}')
  })

  it('PR com base main ou develop, e reutilizável (workflow_call com o alvo)', () => {
    expect(yml).toMatch(
      /pull_request:\n {4}types: \[opened, synchronize, reopened\]\n( {4}#[^\n]*\n)* {4}branches: \[main, develop\]/
    )
    expect(yml).toMatch(/workflow_call:\n {4}inputs:\n {6}alvo:\n/)
    expect(yml).not.toMatch(/^ {2}workflow_run:/m)
  })

  it('mantém o job "Regressão (UAT)" (check obrigatório)', () => {
    expect(yml).toMatch(/^ {4}name: Regressão \(UAT\)$/m)
  })

  it('workflow_call com alvo vazio falha antes de tudo (nunca cai no webServer local)', () => {
    const p = passo('Recusar chamada sem alvo')
    expect(passos.indexOf(p)).toBe(0)
    expect(p).toMatch(/^ {8}if: github\.event_name != 'pull_request' && inputs\.alvo == ''$/m)
    expect(p).toContain('::error::')
    expect(p).toContain('exit 1')
  })

  it('com alvo: não espera o preview e usa o alvo como base URL', () => {
    expect(passo('Aguardar o preview do PR')).toMatch(/if: [^\n]*!inputs\.alvo/)
    expect(passo('Regressão (Playwright)')).toContain(
      'E2E_BASE_URL: ${{ inputs.alvo || steps.preview.outputs.url }}'
    )
  })

  it('com alvo: roda como remoto (auth0 e segredos do UAT)', () => {
    const p = passo('Regressão (Playwright)')
    expect(p).toContain(
      "E2E_AUTH: ${{ (vars.E2E_TARGET == 'preview' || inputs.alvo) && 'auth0' || '' }}"
    )
    expect(p).not.toMatch(/: \$\{\{ vars\.E2E_TARGET == 'preview' &&/)
  })

  it('checkout do SHA do PR ou do push que chamou', () => {
    expect(yml).toContain('ref: ${{ github.event.pull_request.head.sha || github.sha }}')
  })

  it('só comenta quando é PR', () => {
    expect(passo('Comentar o resultado no PR')).toMatch(
      /if: [^\n]*github\.event_name == 'pull_request'/
    )
  })

  it('concorrência por PR (cancela) ou pelo SHA no UAT (sem cancelar)', () => {
    expect(yml).toContain(
      "group: e2e-regressao-${{ github.event.pull_request.number || format('uat-{0}', github.sha) }}"
    )
    expect(yml).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
  })
})

describe('required checks', () => {
  it('Deploy não é check obrigatório', () => {
    expect(ler('hooks/protect-main/config.json')).not.toContain('Deploy')
  })
})
