# Runbook: GitHub App `esteira-promover` (criar, instalar, segredos, bypass, rotacionar)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Prod

## Objetivo

Criar e instalar a GitHub App `esteira-promover`, a credencial do fast-forward da `main` na
promoção e da abertura do PR de back-promotion
([ADR-020](../adr/template/020-esteira-integracao-e-promocao.md),
[ADR-021](../adr/template/021-hotfix-e-back-promotion.md)); gravar `ESTEIRA_APP_ID` e
`ESTEIRA_APP_PRIVATE_KEY` no Environment `production`; dar à App o bypass da branch protection
da `main`; rotacionar a chave. Chamado pelo [adotar-esteira-develop.md](./adotar-esteira-develop.md).

Como a App é usada (para conferir permissões e logs):

- **Permissões da App** (repositório): _Contents_ write (FF da `main`), _Deployments_ write,
  _Workflows_ write (o FF é recusado se o intervalo promovido mexe em `.github/workflows/*`) e
  _Pull requests_ write (abrir/atualizar a back-promotion). _Metadata_ read é automático.
- O token é gerado a cada run por `actions/create-github-app-token`, com **escopo explícito**
  (`permission-*`): no `promover.yml`, `contents`/`deployments`/`workflows: write`; no
  `back-promotion.yml`, `pull-requests: write` e `contents: read`. Vale 1 h e nunca vai para log.
- No `promover.yml` o token da App é usado **só no checkout/push** (pusher
  `esteira-promover[bot]`). As chamadas de API (deployments, checks, issues, release) usam o
  `GITHUB_TOKEN` do job: por isso a Release criada na promoção **não dispara** outros workflows —
  intencional (o `release.yml` também pula o push da App).
- O FF da App dispara a `Guarda da main`, o `deploy.yml` e o `release.yml`, que reconhecem o
  pusher e não refazem nada.

## Pré-condições

- Humano com admin no repositório `<preencher: owner/repo>` (e na org, se a App for da org).
- Decidido o dono da App: conta pessoal ou org `<preencher: dono da App>` (uma App serve todos os
  repositórios do dono que adotarem a esteira).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Conferir se a App já existe e está instalada no repositório: `gh api repos/<preencher: owner/repo>/installation --jq '.app_slug'` (404 = não instalada).

## Passos

1. [R3] Humano: criar a App em Settings → Developer settings → GitHub Apps → _New GitHub App_ (ou na org): nome `esteira-promover`, sem webhook, _Only on this account_, permissões de repositório _Contents_ **Read and write**, _Deployments_ **Read and write**, _Workflows_ **Read and write**, _Pull requests_ **Read and write**; nenhuma outra. Anotar o _App ID_ (não é segredo).
   Verificar: a página da App mostra as quatro permissões de escrita e nenhuma outra além de _Metadata_ read.
2. [R3] Humano: gerar uma _private key_ (`.pem`) na página da App e guardá-la fora do repositório e fora da sessão do agente.
   Verificar: a página da App lista uma chave com a data de hoje.
3. [R3] Humano: instalar a App só nos repositórios que adotam a esteira (_Install App_ → _Only select repositories_ → `<preencher: owner/repo>`).
   Verificar: `gh api repos/<preencher: owner/repo>/installation --jq '.app_slug'` → `esteira-promover`.
4. [R3] Humano: criar o Environment `production` (Settings → Environments) com _Deployment branches and tags_ restrito à branch `main` e **sem** _Required reviewers_ (reviewers bloqueariam toda promoção e toda back-promotion; se o time exigir aprovação humana, registrar num ADR do projeto que cada back-promotion também vai esperar).
   Verificar: `gh api repos/<preencher: owner/repo>/environments/production --jq '.deployment_branch_policy, [.protection_rules[].type]'` mostra a política de branches e não lista `required_reviewers`.
5. [R2] Gravar os segredos no Environment `production` — o humano digita no prompt (nunca no chat): `gh secret set ESTEIRA_APP_ID --env production --repo <preencher: owner/repo>` e `gh secret set ESTEIRA_APP_PRIVATE_KEY --env production --repo <preencher: owner/repo> < <caminho do .pem>` (num terminal fora da sessão do agente); depois apagar o `.pem` local.
   Verificar: `gh secret list --env production --repo <preencher: owner/repo>` lista os **nomes** `ESTEIRA_APP_ID` e `ESTEIRA_APP_PRIVATE_KEY`.
6. [R3] Humano: se o repositório tem branch protection ou ruleset na `main`, pôr a App `esteira-promover` na lista de bypass (ruleset: _Bypass list_ → _Apps_; branch protection clássica: _Allow specified actors to bypass required pull requests_), para o FF sem PR. Sem branch protection: nada a fazer (as camadas 1–3 do ADR-005 seguem valendo).
   Verificar: `gh api repos/<preencher: owner/repo>/rulesets --jq '.[] | {name, bypass_actors}'` (ou `gh api repos/<preencher: owner/repo>/branches/main/protection --jq '.required_pull_request_reviews.bypass_pull_request_allowances'`) lista a App.

## Verificação final

- App instalada no repositório com as quatro permissões; segredos no Environment `production`
  restrito à `main`, sem reviewers; bypass da `main` (se houver proteção).
- Primeira promoção ([promover-prod.md](./promover-prod.md)): o push na `main` aparece com o pusher
  `esteira-promover[bot]` e a `Guarda da main` fica verde.

## Rollback

1. [R3] Humano: rotacionar a chave (rotina ou vazamento): gerar uma _private key_ nova na página da App, regravar `ESTEIRA_APP_PRIVATE_KEY` como no passo 5 e só então apagar a chave antiga na página da App.
   Verificar: `gh secret list --env production --repo <preencher: owner/repo>` mostra `ESTEIRA_APP_PRIVATE_KEY` com data de hoje e a página da App lista só a chave nova; o próximo run do `promover.yml` gera o token.
2. [R3] Humano: desfazer a adoção da App: remover o bypass (passo 6), desinstalar a App do repositório e apagar os segredos (`gh secret delete ESTEIRA_APP_ID --env production --repo <preencher: owner/repo>` e o mesmo para `ESTEIRA_APP_PRIVATE_KEY`).
   Verificar: `gh api repos/<preencher: owner/repo>/installation` → 404 e `gh secret list --env production --repo <preencher: owner/repo>` não lista os nomes.

## Registro

Issue com label `ops` (`gh issue create --label ops --title "esteira: app esteira-promover" --body-file <arquivo>`):
runbook + `Última verificação`, App ID (não é segredo), repositórios instalados, permissões,
passos R3 feitos pelo humano, data da chave. Nunca o conteúdo da chave.
