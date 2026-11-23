# Runbook: Adotar a esteira (branch `develop`, promoção do mesmo pacote)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT, Prod

## Objetivo

Ligar num projeto a esteira "build once, promote" do
[ADR-020](../adr/template/020-esteira-integracao-e-promocao.md) e do
[ADR-021](../adr/template/021-hotfix-e-back-promotion.md): criar a `develop`, preparar o host, a
GitHub App e o repositório, e ligar o bloco `esteira` por PR. **Opt-in**: sem o bloco, tudo
funciona como hoje (trunk na `main`, [deploy-uat.md](./deploy-uat.md) e
[deploy-prod.md](./deploy-prod.md)). O repositório do template **não** adota a esteira.

O que muda **ao ligar o bloco** (por isso a ordem dos passos importa):

- O `deploy.config.json` passa a ser validado com mais rigor: Heroku exige `heroku.uatApp` e
  `heroku.prodApp`; Vercel exige `vercel.uatAlias` e `vercel.team`; Cloud Run exige os campos do
  serviço de UAT (`cloudrun.uat.*`, já exigidos hoje). O deploy de Prod também falha com o config
  ausente (Vercel sem `uatAlias`/`team`) ou inválido.
- A `develop` entra nas três camadas de proteção (regra 0) sem editar `protectedBranches`.
- O push na `main` só faz deploy de Prod se não vier do FF da App (hotfix); o push na `develop`
  faz o deploy de UAT e a `Regressão (UAT)` contra o UAT fixo.
- O gatilho `develop` é **fixo** em `main-guard.yml`, `deploy.yml`, `ci.yml`, `pr-gate.yml`,
  `e2e-regressao.yml` e `spec-gate.yml` (workflows não leem o config). Se `esteira.integracao` ≠ `develop`, edite
  esses gatilhos no mesmo PR (os YAMLs têm comentário no ponto a mudar).

## Pré-condições

- `bootstrap-ambientes.md` executado (host, Neon, Auth0, envs, UAT fixo) e o projeto no último
  sync do template ([ADR-015](../adr/template/015-template-sync.md)).
- **E2E configurado** (`playwright.config.ts` e `tests/e2e/cenarios.config.json`,
  [guia de E2E](../guides/e2e-guide.md#adoção)). Sem ele, o check `Regressão (UAT)` sai **verde com
  aviso** ([ADR-016](../adr/template/016-testes-e2e-nascidos-da-spec.md)) e a promoção não tem
  regressão real: recomendado configurar antes de ligar a esteira.
- Nenhum PR aberto que dependa de a `main` ser a trunk (mergear ou rebasear para a `develop` depois).
- Humano com admin no repositório e no host.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Conferir a conta e o projeto do host: Pre-flight do runbook do host (host-<host>.md).
3. [R0] Conferir que a esteira ainda está desligada e o host: `node scripts/esteira/index.mjs ativa` → `ativa=false` e `node scripts/deploy/index.mjs host` → `<preencher: host do projeto>`.
4. [R0] Conferir que a `develop` não existe: `git ls-remote --heads origin develop` (vazio).

## Passos

1. [R0] Inventário de `NEXT_PUBLIC_*` (Heroku/Cloud Run, que promovem o pacote): `rg -n 'NEXT_PUBLIC_' --glob '!node_modules' src app` e, para cada nome, comparar o valor de UAT e de Prod (só nomes no chat: bloco **Segredos e envs** do runbook do host).
   Verificar: lista de `NEXT_PUBLIC_*` anotada, cada uma marcada `igual` ou `difere` entre UAT e Prod (ex.: domínio do Auth0, URL da API). Na Vercel (rebuild do mesmo SHA com o env de cada ambiente), só anotar.
2. [R1] Migrar para runtime cada `NEXT_PUBLIC_*` que `difere` (rota `/api/config` ou render no servidor), numa feature branch + PR com base `main` (a `develop` ainda não existe).
   Verificar: o `rg` do passo 1 não acha mais nomes `difere`; PR mergeado pelo humano e Prod ok ([deploy-prod.md](./deploy-prod.md)).
3. [R3] Humano: criar a `develop` a partir da `main`: `git push origin origin/main:refs/heads/develop` (ou o botão _New branch_ no GitHub, a partir da `main`) e avisar. O agente não cria nem escreve na `develop`.
   Verificar: `git fetch origin && git rev-parse origin/develop origin/main` → os dois SHAs iguais.
4. [R3] Humano: em Settings → General → Pull Requests, ligar também **Allow merge commits** (`allow_merge_commit=true`, usado só na back-promotion; a Guarda e o `PR gate` alarmam no resto), mantendo squash com "Default to pull request title" e rebase desligado.
   Verificar: `gh api repos/<preencher: owner/repo> --jq '.allow_squash_merge, .allow_merge_commit, .allow_rebase_merge, .squash_merge_commit_title'` → `true true false PR_TITLE`.
5. [R3] Humano: criar e instalar a GitHub App `esteira-promover`, o Environment `production` (restrito à `main`, sem reviewers) e os segredos dela: [esteira-github-app.md](./esteira-github-app.md), passos 1–5.
   Verificar: os `Verificar:` daqueles passos passam.
6. [R3] Humano: se houver branch protection/ruleset, proteger a `develop` igual à `main` (PR obrigatório, required checks de `hooks/protect-main/config.json`) e pôr a App no bypass **só da `main`** ([esteira-github-app.md](./esteira-github-app.md), passo 6). Sem branch protection: confirmar a `Guarda da main` ativa.
   Verificar: `gh api repos/<preencher: owner/repo>/branches/develop/protection --jq '.required_status_checks.contexts'` lista os checks (ou `gh workflow list` mostra `Guarda da main` `active`).
7. [R2] Gravar `vars.PROD_URL` (URL de Prod do smoke test; Heroku e Cloud Run — sem ela a promoção falha antes de tocar Prod): `gh variable set PROD_URL --body https://<preencher: domínio de Prod> --repo <preencher: owner/repo>`.
   Verificar: `gh variable list --repo <preencher: owner/repo>` lista `PROD_URL`.
8. [R2] Só Heroku: gravar o segredo de escrita `HEROKU_DEPLOY_API_KEY`: o humano gera um token com escopo de escrita nos apps do pipeline (`heroku authorizations:create --description esteira-deploy --scope write,read`, num terminal fora da sessão) e roda `gh secret set HEROKU_DEPLOY_API_KEY --repo <preencher: owner/repo>`, digitando no prompt. Ele é lido **só** pelo `promover.yml` e pelos jobs de push do `deploy.yml`, **nunca** em `pull_request`; o `HEROKU_API_KEY` continua **só leitura**.
   Verificar: `gh secret list --repo <preencher: owner/repo>` lista `HEROKU_DEPLOY_API_KEY` e `HEROKU_API_KEY`.
9. [R2] Só Cloud Run: criar o serviço de UAT fixo se ainda não existir (bloco **Bootstrap** do [host-cloudrun.md](./host-cloudrun.md)) e dar à SA de Prod leitura no repositório do UAT — Prod roda a imagem de UAT por digest: `gcloud artifacts repositories add-iam-policy-binding <preencher: repositório Artifact Registry> --location <preencher: região, ex. us-east1> --project <preencher: projeto GCP UAT> --member serviceAccount:<preencher: SA de deploy de Prod> --role roles/artifactregistry.reader`.
   Verificar: `gcloud artifacts repositories get-iam-policy <preencher: repositório Artifact Registry> --location <preencher: região, ex. us-east1> --project <preencher: projeto GCP UAT> --format=json | jq '.bindings[] | select(.role == "roles/artifactregistry.reader")'` lista a SA de Prod; `jq '.cloudrun.uat' deploy.config.json` tem `project`, `service`, `wifProvider` e `serviceAccount`.
10. [R2] Só Vercel: fazer da `develop` o UAT — no Hobby, restringir as envs de **Preview** de UAT à branch `develop` (Settings → Environment Variables → Preview → _Branch_ `develop`); no Pro, criar o Custom Environment `uat` ligado à branch `develop`. Anotar o alias estável da branch (`<projeto>-git-develop-<team>.vercel.app` ou domínio próprio). Gravar `secrets.VERCEL_TOKEN` (o humano digita: `gh secret set VERCEL_TOKEN --repo <preencher: owner/repo>`), `vars.VERCEL_ORG_ID` e `vars.VERCEL_PROJECT_ID` (`gh variable set … --repo <preencher: owner/repo>`): o `vercel rollback` roda no CI sem projeto linkado. O `vercel` CLI é instalado pelo `promover.yml` (`vercel@66`).
    Verificar: `gh secret list --repo <preencher: owner/repo>` lista `VERCEL_TOKEN`, `gh variable list --repo <preencher: owner/repo>` lista `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID`, e um push na `develop` gera um deploy com as envs de UAT.
11. [R1] Abrir o PR que liga a esteira, na branch **`hotfix/liga-esteira`** com base `main` (com o bloco no head, o `PR gate` só aceita `hotfix/*` na base `main`). No mesmo PR: em `hooks/protect-main/config.json`, `"esteira": { "integracao": "develop", "producao": "main", "prefixoHotfix": "hotfix/", "promotores": ["<preencher: login de quem promove>"] }`; no `deploy.config.json`, Heroku `"uatApp": "<preencher: nome do app>-uat"` e `"prodApp": "<preencher: nome do app>-prod"` no bloco `heroku`, ou Vercel `"vercel": { "uatAlias": "<preencher: alias da develop>", "team": "<preencher: team Vercel>" }`; se a integração não for `develop`, os gatilhos dos cinco workflows. Título `ci(esteira): liga a esteira develop → main`, seção `## UAT` desmarcada.
    Verificar: na branch, `node scripts/esteira/index.mjs ativa` → `ativa=true` e `node scripts/deploy/index.mjs host` não falha (config validado com a esteira); `gh pr checks <n> --watch` verde, exceto o `PR gate`, que espera o passo 12.
12. [R3] Humano: na seção `## UAT` do PR, marcar "UAT não se aplica — liga a esteira" e avisar.
    Verificar: `gh pr checks <n>` mostra `PR gate` `pass`.
13. [R2] Só Heroku, logo antes do merge: tirar o **auto-deploy da `main`** do app `-prod` (dashboard do pipeline → `-prod` → _Deploy_ → _Disable Automatic Deploys_; senão todo FF da promoção recompila Prod). A partir daqui, Prod só muda pela esteira.
    Verificar: o dashboard do `-prod` mostra _Automatic deploys_ desligado.
14. [R3] Humano: mergear o PR na `main` com squash e avisar. O push roda como hotfix (deploy de Prod do commit, `release.yml` corta a tag) e, com a Release verde, o `back-promotion.yml` abre o PR `chore(release): back-promotion de vX.Y.Z` (`main` → `develop`).
    Verificar: `gh run list --workflow deploy.yml --branch main --limit 1` e `gh run list --workflow release.yml --limit 1` verdes; `gh pr list --base develop --head main --state open` lista a back-promotion (ausente → [hotfix.md](./hotfix.md), passo 9).
15. [R3] Humano: mergear a back-promotion na `develop` com **Create a merge commit** e avisar. É assim que a `develop` recebe o bloco `esteira` sem push direto (a Guarda alarmaria).
    Verificar: `git fetch origin && git merge-base --is-ancestor origin/main origin/develop && echo ok` → `ok` e `git show origin/develop:hooks/protect-main/config.json | jq .esteira` mostra o bloco.
16. [R0] Conferir o primeiro deploy de UAT pela esteira: `gh run list --workflow deploy.yml --branch develop --limit 1` e `gh run watch <run-id>`.
    Verificar: Deployment `uat` `success` do SHA da `develop` e check `Regressão (UAT)` (`external_id` `esteira-uat`) no SHA; `gh run list --workflow main-guard.yml --limit 2` verde.
17. [R0] Avisar o humano das mudanças de rotina: feature branch a partir da `develop` e PR com base `develop`; Prod só pelo [promover-prod.md](./promover-prod.md); correção urgente pelo [hotfix.md](./hotfix.md).
    Verificar: o humano confirmou; PRs abertos com base `main` (exceto `hotfix/*`) foram retargetados para `develop` (`gh pr edit <n> --base develop`).

## Verificação final

- `develop` criada da `main`, protegida nas três camadas; esteira ligada; `deploy.config.json`
  válido com a esteira; App, Environment `production` (só `main`, sem reviewers) e segredos
  prontos; `allow_merge_commit=true`; host preparado (Heroku sem auto-deploy no `-prod`; Cloud Run
  com a SA de Prod lendo o registry de UAT; Vercel com a `develop` como UAT).
- Primeiro deploy de UAT pela esteira com `Regressão (UAT)` publicada no SHA; a primeira promoção
  segue o [promover-prod.md](./promover-prod.md).

## Rollback

1. [R1] Desligar a esteira por PR `hotfix/desliga-esteira` com base `main` (com a esteira ligada, a base `main` só aceita `hotfix/*`): remover o bloco `esteira` de `hooks/protect-main/config.json` (tudo volta ao fluxo de hoje; o humano marca "UAT não se aplica" e faz o merge).
   Verificar: `node scripts/esteira/index.mjs ativa` → `ativa=false` na `main` após o merge.
2. [R2] Só Heroku: religar o auto-deploy da `main` no `-prod` (dashboard do pipeline) e apagar `HEROKU_DEPLOY_API_KEY` (`gh secret delete HEROKU_DEPLOY_API_KEY --repo <preencher: owner/repo>`; o humano revoga o token).
   Verificar: o próximo merge na `main` gera build no `-prod` e `gh secret list` não lista `HEROKU_DEPLOY_API_KEY`.
3. [R3] Humano: voltar `allow_merge_commit=false`, remover a proteção da `develop` e, se ninguém mais a usa, a App ([esteira-github-app.md](./esteira-github-app.md), Rollback) e a própria `develop` (depois de levar à `main`, por PR, o que só estava nela).
   Verificar: `gh api repos/<preencher: owner/repo> --jq '.allow_merge_commit'` → `false`.

## Registro

Issue com label `ops` (`gh issue create --label ops --title "adoção da esteira" --body-file <arquivo>`):
runbook + `Última verificação`, host, inventário de `NEXT_PUBLIC_*` (só nomes, `igual`/`difere`),
PRs da adoção, passos R3 feitos pelo humano, aprovações R2, primeiro deploy de UAT. Sem segredos.
