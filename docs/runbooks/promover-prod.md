# Runbook: Promover para Prod (esteira — o pacote do UAT vai para Prod)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT, Prod

## Objetivo

Levar para Prod **o pacote que está no UAT** e avançar a `main` por fast-forward para esse SHA,
pelo workflow `Promover para Prod` (`promover.yml`), na esteira do
[ADR-020](../adr/template/020-esteira-integracao-e-promocao.md). Só vale com o bloco `esteira` em
`hooks/protect-main/config.json`; sem ele, Prod é o merge na `main` ([deploy-prod.md](./deploy-prod.md)).
O **disparo é do humano** (`[R3]` para o agente, barrado pelo hook `protect-main`); o agente
confere as pré-condições, acompanha o run e faz a verificação.

Quem pode promover: os logins de `esteira.promotores`. O workflow só roda a partir de `main`
(disparado em outra ref, o job com o Environment `production` é pulado com aviso), com
`concurrency: promover` e **sem cancelar** um run em andamento.

**Ordem no Heroku e no Cloud Run** (mesmo pacote):

- (1) Checagens: ator em `esteira.promotores`; SHA do último Deployment `uat` bem-sucedido
  (`ultimoOk('uat')`); check `Regressão (UAT)` marcado (`external_id` `esteira-uat`) verde nesse
  SHA; `main` ancestral do SHA.
- (2) `promoverProd` (Heroku: pipeline promotion do slug do `-uat`; Cloud Run: deploy pelo digest).
- (3) Registrar o Deployment `production` do SHA com `success`.
- (4) Smoke test em `PROD_URL` (variável do repositório; sem ela a promoção falha antes de tocar Prod).
- (5) Smoke falhou → `rollbackProd`, Deployment `failure`, **sem FF** (a `main` não avança).
- (6) Fast-forward da `main` com o token da App `esteira-promover`.
- (7) Tag `vX.Y.Z` e GitHub Release (maior bump dos títulos dos PRs desde a última tag).

**Ordem na Vercel** (V1, mesmo SHA com rebuild — garantia de mesmo commit, não de mesmo pacote):

- (1) Checagens (as mesmas).
- (2) Registrar o Deployment `production` com `success` **antes** do FF (senão a `Guarda da main`
  alarma o push da App).
- (3) FF da `main`: a Vercel builda Production desse SHA.
- (4) Esperar o Deployment `Production*` do SHA na API de Deployments do GitHub.
- (5) Smoke test.
- (6) Falhou → `vercel rollback`, Deployment `failure` e issue `esteira` "main à frente de Prod"
  (a `main` já avançou; a correção segue pelo [hotfix.md](./hotfix.md)).

## Pré-condições

- Esteira adotada ([adotar-esteira-develop.md](./adotar-esteira-develop.md)) e App instalada
  ([esteira-github-app.md](./esteira-github-app.md)).
- O humano testou e aprovou o UAT do SHA que está lá (site/celular).
- Nenhuma back-promotion pendente (PR `main` → `develop` aberto ou não mergeado).
- Só Vercel: a atribuição automática do domínio de Prod está **ligada**. Depois de qualquer
  `vercel rollback` (o automático da promoção ou o manual), a Vercel a desliga: a promoção seguinte
  builda Production do SHA, o smoke em `PROD_URL` responde `200` do deploy **antigo** e o run sai
  verde com Prod velha. Religar antes de promover (ver "Vercel depois de um rollback" abaixo).
- Migração aditiva, se houver, já aplicada em Prod ([migracao-banco.md](./migracao-banco.md));
  features novas desligadas em Prod ([feature-flags.md](./feature-flags.md)).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Conferir a conta e o projeto do host: Pre-flight do runbook do host (host-<host>.md).
3. [R0] Conferir a esteira: `node scripts/esteira/index.mjs ativa` mostra `ativa=true` e `jq -r '.esteira.promotores[]' hooks/protect-main/config.json` lista o login de quem vai disparar.
4. [R0] Anotar o deploy de Prod atual (alvo do rollback manual): bloco **Prod** do runbook do host, passo de anotar o deploy atual.

## Passos

1. [R0] Ler o SHA que está no UAT: `gh api 'repos/<preencher: owner/repo>/deployments?environment=uat&per_page=5' --jq '.[] | [.sha, .payload.sha, .created_at] | @tsv'` e o status do mais recente (`gh api repos/<preencher: owner/repo>/deployments/<id>/statuses --jq '.[0].state'`).
   Verificar: o Deployment `uat` mais recente está `success`; anotar `<sha>`.
2. [R0] Conferir a regressão no UAT desse SHA: `gh api repos/<preencher: owner/repo>/commits/<sha>/check-runs --jq '.check_runs[] | select(.name == "Regressão (UAT)" and .external_id == "esteira-uat") | .conclusion'`.
   Verificar: `success`. Vermelho ou ausente → parar (a promoção recusa); corrigir pela `develop`.
3. [R0] Conferir que não há back-promotion pendente: `git fetch origin && git merge-base --is-ancestor origin/main <sha> && echo ok` e `gh pr list --base develop --head main --state open`.
   Verificar: `ok` e nenhum PR aberto. Senão → mergear a back-promotion (humano, [hotfix.md](./hotfix.md)) e esperar o novo deploy de UAT.
4. [R3] Humano: disparar a promoção a partir da `main`: `gh workflow run promover.yml --ref main` (ou Actions → **Promover para Prod** → _Run workflow_ na branch `main`) e avisar quando disparou.
   Verificar: `gh run list --workflow promover.yml --limit 1` mostra o run do humano em andamento.
5. [R0] Acompanhar o run: `gh run watch <run-id>` (sem cancelar: `concurrency` não cancela).
   Verificar: job `Promover para Prod` verde. Vermelho → ler o log (passo 6) e seguir a tabela de falhas da Verificação final.
6. [R0] Conferir o resultado: `git fetch origin && git rev-parse origin/main` e `gh release view --repo <preencher: owner/repo>`.
   Verificar: `origin/main` = `<sha>` e a Release `vX.Y.Z` mais recente aponta para `<sha>`.
7. [R0] Smoke test em Prod: `curl -s -o /dev/null -w '%{http_code}' https://<preencher: domínio de Prod>/` e `curl -si -X POST https://<preencher: domínio de Prod>/api/mcp | grep -i '^www-authenticate:.*resource_metadata'`.
   Verificar: `200` na home e `401` com `WWW-Authenticate` contendo `resource_metadata`.
8. [R0] Observar erros por alguns minutos: bloco **Prod** do runbook do host, passo de logs.
   Verificar: sem pico de erros 5xx novos (havendo → [rollback.md](./rollback.md)).

## Verificação final

- `origin/main` = SHA promovido; Deployment `production` desse SHA `success`; Release `vX.Y.Z`
  criada; smoke ok; humano avisado.
- Mensagens de falha do run e o que fazer:
  - "não está em esteira.promotores" → quem disparou não é promotor; o humano ajusta o config por PR.
  - "PROD_URL … é obrigatória" (Heroku/Cloud Run) → gravar `vars.PROD_URL` ([adotar-esteira-develop.md](./adotar-esteira-develop.md)); Prod não foi tocada.
  - "Regressão (UAT) não está verde" ou "sem deploy de UAT bem-sucedido" → corrigir pela `develop`.
  - "há back-promotion pendente: mergeie o PR main → develop e aguarde o novo deploy de UAT" →
    [hotfix.md](./hotfix.md), passos da back-promotion.
  - "a `main` já está em `<sha>`: nada a promover" → no-op com aviso.
  - Smoke falhou (Heroku/Cloud Run) → o rollback já foi feito e a `main` não avançou; investigar e
    corrigir pela `develop`.
  - `promoverProd` falhou no meio (Heroku: slug divergente ou timeout) → o rollback é automático;
    se o próprio rollback falhar, a mensagem pede verificar Prod à mão → [rollback.md](./rollback.md).
  - Smoke falhou na Vercel → `vercel rollback` já feito, issue `esteira` "main à frente de Prod"
    aberta; corrigir por [hotfix.md](./hotfix.md).
  - **Vercel depois de um rollback** (automático ou manual): a atribuição automática do domínio de
    Prod fica **desligada** e nenhuma promoção ou hotfix seguinte entra no ar, embora o run fique
    verde. Passo do humano (`[R2]`, Prod, aprovação por operação): quando o deploy certo existir
    (o do hotfix ou da próxima promoção), `vercel promote <url-do-deploy> --scope <preencher: team Vercel>`
    — o `promote` religa a atribuição automática — ou religá-la em Settings → Domains. Conferir
    com `vercel inspect https://<preencher: domínio de Prod> --scope <preencher: team Vercel>`, que
    precisa mostrar o deploy do SHA promovido ([host-vercel.md](./host-vercel.md), passos 13–14).
  - Release falhou **depois** do FF → re-rodar o workflow é no-op (a `main` já é o SHA) e **não
    cria a tag**. Recuperar à mão: o **humano** (`[R3]`, o `protect-main` barra o agente) re-roda ou dispara a release do SHA no Actions; ou aguardar a próxima promoção, que
    absorve o intervalo na versão.
- A Release criada pela promoção usa o `GITHUB_TOKEN` do job e **não dispara** outros workflows
  (intencional; o `release.yml` também pula o push da App).

## Rollback

1. [R2] Voltar Prod ao deploy anotado no pre-flight: [rollback.md](./rollback.md) → bloco **Rollback** do runbook do host (Heroku: slug anterior com o config **atual**; Cloud Run: a revisão que servia 100% antes; Vercel: `vercel rollback --yes --scope <preencher: team Vercel>`) — pedir aprovação.
   Verificar: os `Verificar:` do bloco mostram o deploy anterior servindo Prod e o smoke test passa. Na Vercel, o `vercel rollback` desliga a atribuição automática do domínio: a próxima promoção só entra no ar depois do `vercel promote` do humano (passo 14 do [host-vercel.md](./host-vercel.md)).
2. [R1] A `main` não volta (nada reescreve o histórico, I4 do ADR-020): abrir a correção pelo [hotfix.md](./hotfix.md) ou um revert pela `develop` e promover de novo.
   Verificar: `gh pr list --state open` mostra o PR da correção.

## Registro

Comentário na issue `ops` da promoção (`gh issue create --label ops --title "promoção vX.Y.Z" --body-file <arquivo>`):
runbook + `Última verificação`, SHA promovido, quem disparou, link do run, Deployment
`production`, tag/Release, smoke, resultado final (`ok` | `rollback` | `interrompido`).
