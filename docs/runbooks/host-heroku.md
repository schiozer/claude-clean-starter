# Runbook: Host Heroku (bootstrap, UAT, Prod, rollback, envs, cron, encerrar)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT, Prod

## Objetivo

Operações do host **Heroku** da camada de deploy: vale quando o `deploy.config.json` tem
`"host": "heroku"`. Os runbooks gerais ([bootstrap-ambientes.md](./bootstrap-ambientes.md),
[deploy-uat.md](./deploy-uat.md), [deploy-prod.md](./deploy-prod.md), [rollback.md](./rollback.md),
[segredos-e-env.md](./segredos-e-env.md), [feature-flags.md](./feature-flags.md)) mantêm o roteiro e
chamam os blocos abaixo — **Bootstrap**, **Bootstrap (pós-envs)**, **UAT**, **Prod**, **Rollback**,
**Segredos e envs**,
**Cron** e **Encerrar**. Execute o bloco que o runbook geral indicar, com o mesmo risco.

O [bootstrap-ambientes.md](./bootstrap-ambientes.md) chama o **Bootstrap** no passo 1 (só a
infraestrutura do host) e o **Bootstrap (pós-envs)** depois de Neon, Auth0, envs e UAT fixo — os
passos que dependem deles.

No Heroku, um **pipeline** `<preencher: nome do app>` tem:

- **review apps**: um por PR, criados e destruídos pelo próprio pipeline (exigem `app.json`). O
  `deploy.yml` é no-op; a `Regressão (UAT)` espera o review app do SHA pela Platform API
  (`HEROKU_API_KEY`, `heroku.pipelineId`);
- app `<preencher: nome do app>-uat`: o **UAT fixo**, que recebe o slug do review app em aceite, sem rebuild;
- app `<preencher: nome do app>-prod`: auto-deploy da `main`.

Next.js pelo buildpack Node (`Procfile`: `web: npm start`; a porta vem de `PORT`). O preview é
**público** e protegido pela autenticação fail-closed do app (sem bypass, como o alias do UAT da
Vercel).

**Auth0 de UAT (decisão da Task 0 da camada de deploy).** Os review apps têm nome aleatório em
`herokuapp.com`, um domínio compartilhado: um curinga ali aceitaria apps de terceiros. Por isso
**não há curinga**. A URL de cada review app é registrada no client de login web do Auth0 de UAT
pela Management API: o `aguardar` (`e2e-regressao.yml`) soma callback e logout, e o `encerrar`
(`deploy.yml`, PR fechado) os remove. Isso só acontece com as quatro configurações `AUTH0_*`
presentes (passo 6). Sem nenhuma delas, o passo é pulado; com só algumas, o job falha nomeando as
que faltam.

## Pré-condições

- Conta Heroku com o time/dono `<preencher: time Heroku>` e forma de pagamento (dynos Eco/Basic; review app custa só enquanto o PR está aberto).
- CLI `heroku` autenticada pelo humano (o agente não faz login por ninguém).
- Humano com admin no repositório e no tenant Auth0 de UAT.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir a conta Heroku: `heroku auth:whoami` → `<preencher: conta Heroku>`.
3. [R0] Conferir o host do repositório: `node scripts/deploy/index.mjs host` não falha e o `deploy.config.json` tem `"host": "heroku"` e `heroku.pipelineId` (no Bootstrap, o `pipelineId` só existe depois do passo 1).

## Passos

### Bootstrap

1. [R2] Criar os apps e o pipeline: `heroku apps:create <preencher: nome do app>-uat --team <preencher: time Heroku>` e `heroku apps:create <preencher: nome do app>-prod --team <preencher: time Heroku>`; depois `heroku pipelines:create <preencher: nome do app> -a <preencher: nome do app>-prod --stage production` e `heroku pipelines:add <preencher: nome do app> -a <preencher: nome do app>-uat --stage staging`.
   Verificar: `heroku pipelines:info <preencher: nome do app>` lista `-uat` em `staging` e `-prod` em `production`; anotar o id do pipeline (`<gerado: id do pipeline Heroku>`, de `heroku pipelines:info <preencher: nome do app> --json`).
2. [R1] Copiar os modelos para a raiz por PR: `cp scripts/deploy/templates/heroku/Procfile scripts/deploy/templates/heroku/app.json .`; trocar o `name` do `app.json` (é placeholder) pelo do projeto; criar o `deploy.config.json` com `{ "host": "heroku", "heroku": { "pipelineId": "<gerado: id do pipeline Heroku>" } }`.
   Verificar: `node scripts/deploy/index.mjs host` não falha e `jq -r .name app.json` → `<preencher: nome do app>`.
3. [R3] Humano: no dashboard do pipeline, conectar o repositório GitHub, ligar os **Review Apps** com criação automática por PR e **destruição automática** quando o PR fecha (ou após `<preencher: dias>` dias parado), e ligar o **auto-deploy da `main`** no app `-prod` (sem "wait for CI", que já gateia o merge). Conectar o GitHub é dar ao Heroku acesso ao repositório (proteção/permissão, R3).
   Verificar: `heroku pipelines:info <preencher: nome do app>` mostra o repositório conectado e, num PR de teste, um review app aparece no pipeline.
4. [R2] Gravar o segredo `HEROKU_API_KEY` do GitHub Actions (usado pelo `aguardar` e pelo `encerrar`): o humano gera um token de longa duração com escopo **somente leitura** (`heroku authorizations:create --description deploy-ci --scope read`, num terminal separado; o escopo `global` leria as config vars do `-prod` e poderia destruir o app, e esse token roda em código de PR) e roda `gh secret set HEROKU_API_KEY --repo <preencher: owner/repo>`, digitando o valor no prompt. O `aguardar` e o `encerrar` só fazem GET (pipeline, review apps, builds); o `encerrar` escreve só no Auth0, com outro segredo.
   Verificar: `heroku authorizations --json | jq -r '.[] | select(.description == "deploy-ci") | .scope[]'` lista só `read` e `gh secret list --repo <preencher: owner/repo>` lista o **nome** `HEROKU_API_KEY`.

### Bootstrap (pós-envs)

Depende dos tenants Auth0 e das envs dos apps (passos 4–7 do bootstrap-ambientes.md).

5. [R3] Humano: no Auth0 de UAT (`<preencher: domínio do tenant Auth0 de UAT>`), criar um client **Machine to Machine** autorizado na Management API com só `read:clients` e `update:clients`, e anotar o _Client ID_ do app de login web do UAT (o que recebe as URLs dos review apps). Mexer em permissões do IdP é do humano.
   Verificar: o humano confirma o client M2M com os dois escopos e informa os dois _Client IDs_ (não são segredo).
6. [R2] Ligar o registro de URLs no Auth0 de UAT: variáveis `gh variable set AUTH0_MGMT_DOMAIN --body <preencher: domínio do tenant Auth0 de UAT> --repo <preencher: owner/repo>`, `gh variable set AUTH0_MGMT_CLIENT_ID --body <client id do M2M> --repo <preencher: owner/repo>`, `gh variable set AUTH0_WEB_CLIENT_ID --body <client id do login web> --repo <preencher: owner/repo>` e, só se a rota de callback do app não for `/api/auth/callback`, `gh variable set AUTH0_CALLBACK_PATH --body <rota> --repo <preencher: owner/repo>`; o segredo, o humano grava com `gh secret set AUTH0_MGMT_CLIENT_SECRET --repo <preencher: owner/repo>`, digitando-o no prompt.
   Verificar: `gh variable list --repo <preencher: owner/repo>` lista os três nomes `AUTH0_MGMT_DOMAIN`, `AUTH0_MGMT_CLIENT_ID` e `AUTH0_WEB_CLIENT_ID`, e `gh secret list --repo <preencher: owner/repo>` lista `AUTH0_MGMT_CLIENT_SECRET`. Na próxima `Regressão (UAT)`, o log de "Aguardar o preview do PR" diz `URL registrada no Auth0: https://…`.
7. [R0] Conferir as envs gravadas pelos passos 4–7 do bootstrap-ambientes.md (bloco **Segredos e envs**): `APP_ENV=uat` no `-uat` e nas _Review app config vars_ do pipeline, `APP_ENV=production` no `-prod`. Faltando alguma → voltar ao [segredos-e-env.md](./segredos-e-env.md) antes do primeiro PR.
   Verificar: `heroku config -a <preencher: nome do app>-uat --json | jq -r 'keys[]'` e o mesmo para `-prod` listam os nomes esperados (só nomes).
8. [R1] Adicionar ao Auth0 de cada ambiente, sem curinga, a URL fixa do app: `https://<gerado: host do app UAT>` no tenant de UAT e `https://<preencher: domínio de Prod>` no de Prod (callback `/api/auth/callback` e logout), pelo dashboard do Auth0; no de Prod é **R2**.
   Verificar: o login pelo Universal Login funciona na URL do `-uat`.

### UAT

9. [R0] Localizar o review app do PR: `heroku pipelines:info <preencher: nome do app> --json` (ou o comentário do `github-actions[bot]` com o alvo da `Regressão (UAT)`) e o slug da última release dele: `heroku releases -a <review-app> --json | jq -r '[.[] | select(.status == "succeeded")] | sort_by(.version) | last | .slug.id'`.
   Verificar: o review app tem a release do SHA do PR com status `succeeded`; anotar `<slug-id>` e, para reverter, a versão atual do `-uat` (`heroku releases -a <preencher: nome do app>-uat -n 1`). O host do `-uat` sai da `web_url` de `heroku apps:info -a <preencher: nome do app>-uat --json | jq -r .app.web_url`.
10. [R1] Apontar o UAT fixo para o review app (mesmo slug, sem rebuild): `curl -n -X POST https://api.heroku.com/apps/<preencher: nome do app>-uat/releases -H 'Accept: application/vnd.heroku+json; version=3' -H 'Content-Type: application/json' -d '{"slug": "<slug-id>", "description": "UAT do PR <n>"}'` (Platform API; o `-n` usa a credencial que o `heroku login` grava no `~/.netrc`, sem token na linha de comando).
    Verificar: `heroku releases -a <preencher: nome do app>-uat -n 1` mostra a release nova com a descrição do PR, e `curl -s -o /dev/null -w '%{http_code}' https://<gerado: host do app UAT>/` → `200`.
11. [R1] Reverter o UAT fixo para a release anterior: o mesmo `curl -n -X POST …/apps/<preencher: nome do app>-uat/releases` do passo 10 com `{"slug": "<slug-id-anterior>", "description": "UAT revertido"}`. O rollback de release do Heroku também serviria, mas fica reservado ao bloco **Rollback** (sempre R2).
    Verificar: `heroku releases -a <preencher: nome do app>-uat -n 1` mostra a release com o slug anterior e a home responde `200`.

A URL do UAT deste host é `https://<gerado: host do app UAT>`.

**Se o login falhar com _callback mismatch_ no review app**: duas `Regressão (UAT)` de PRs diferentes
podem ler e regravar a lista de callbacks ao mesmo tempo, e uma URL se perde. Rode de novo o job
`Regressão (UAT)` do PR (`gh run rerun <run-id> --failed`): o `aguardar` registra a URL outra vez,
de forma idempotente.

### Prod

**Com a esteira** ([ADR-020](../adr/template/020-esteira-integracao-e-promocao.md)): o `-prod` fica
**sem auto-deploy** da `main`; Prod recebe por _pipeline promotion_ o **slug** que está no `-uat`
(`heroku.uatApp`/`heroku.prodApp` no `deploy.config.json`), pelo `promover.yml`
([promover-prod.md](./promover-prod.md)), ou o build do tarball do hotfix ([hotfix.md](./hotfix.md)).
A escrita usa `HEROKU_DEPLOY_API_KEY` (só nos jobs de push e no `promover.yml`); o `HEROKU_API_KEY`
segue só leitura. Os passos 12 e 14 valem iguais; no 13, acompanhar o run do `promover.yml` (ou do
`deploy.yml` do hotfix) em vez do auto-deploy.

12. [R0] Anotar a release atual de Prod (alvo do rollback): `heroku releases -a <preencher: nome do app>-prod -n 3`.
    Verificar: a release de topo está `succeeded`; anotar `<versão-atual>` (ex.: `v41`).
13. [R0] Acompanhar o deploy de Produção (auto-deploy do merge): `heroku releases -a <preencher: nome do app>-prod -n 1` e `heroku builds -a <preencher: nome do app>-prod -n 1`.
    Verificar: o build do `mergeCommit` fica `succeeded` e vira a release de topo (`failed` → [rollback.md](./rollback.md)).
14. [R0] Observar erros por alguns minutos: `heroku logs --tail -a <preencher: nome do app>-prod` (interromper após alguns minutos).
    Verificar: sem pico de `status=5xx` nem `H1x`/`R1x` novos (havendo → [rollback.md](./rollback.md)).

A URL de Prod deste host é `https://<preencher: domínio de Prod>`.

### Rollback

**Com a esteira**: o smoke test falho da promoção já volta Prod para o `{slug}` da release
anterior com o config **atual** (as config vars não voltam — escolha registrada no ADR-020). Os
passos abaixo são o rollback manual; sem auto-deploy, o revert chega a Prod pela promoção ou por
hotfix, não pelo merge.

15. [R0] Identificar a release atual e a anterior saudável: `heroku releases -a <preencher: nome do app>-prod -n 5` e diagnosticar com `heroku logs -a <preencher: nome do app>-prod -n 500`.
    Verificar: `<versão-atual>` e `<versão-anterior>` anotadas; a feature/commit suspeito está identificado.
16. [R2] Voltar Prod para a release anterior saudável: `heroku releases:rollback <versão-anterior> -a <preencher: nome do app>-prod`. O auto-deploy continua ligado: o próximo merge (o revert) entra no ar normalmente.
    Verificar: `heroku releases -a <preencher: nome do app>-prod -n 1` mostra `Rollback to <versão-anterior>` e o smoke test passa.
17. [R2] Se o rollback piorou o cenário, voltar à release anotada: `heroku releases:rollback <versão-atual> -a <preencher: nome do app>-prod`.
    Verificar: `heroku releases -a <preencher: nome do app>-prod -n 1` mostra `Rollback to <versão-atual>`.

### Segredos e envs

No Heroku as envs ficam **por app** (`-uat`, `-prod`); os review apps herdam as _Review app config
vars_ do pipeline. Toda mudança de config cria uma release e reinicia os dynos, então não há passo
de redeploy. Todo `heroku config:set` é **R2**, inclusive no `-uat` (cada um vira uma release).

18. [R0] Listar as envs do app (só nomes): `heroku config -a <app> --json | jq -r 'keys[]'`.
    Verificar: a saída tem só nomes (nunca rode `heroku config` sem o filtro: mostra os valores, R3).
19. [R2] Env **não-secreta**: `heroku config:set <NOME>=<valor> -a <app>` (ex.: `APP_ENV`, flags `on`/`off`). Nos review apps, pelo dashboard do pipeline (_Review app config vars_).
    Verificar: `heroku config -a <app> --json | jq -r 'keys[]'` lista `<NOME>` e `heroku releases -a <app> -n 1` mostra `Set <NOME> config vars`.
20. [R2] **Segredo** (criar ou rotacionar): o agente pede ao humano que, **num terminal separado, fora da sessão do agente** (ou pelo dashboard, _Settings → Config Vars_), rode `read -s VALOR` (digita o valor sem eco), depois `heroku config:set <NOME>="$VALOR" -a <app>` e, por fim, `unset VALOR`. O valor nunca aparece em linha de comando com literal nem no histórico; nunca pelo prefixo `!` da sessão.
    Verificar: `heroku config -a <app> --json | jq -r 'keys[]'` lista `<NOME>` e a release nova aparece em `heroku releases -a <app> -n 1`.
21. [R2] Remover uma env: `heroku config:unset <NOME> -a <app>`.
    Verificar: `heroku config -a <app> --json | jq -r 'keys[]'` não lista mais `<NOME>`.

### Cron

22. [R1] No app `-uat`, adicionar o **Heroku Scheduler** (`heroku addons:create scheduler:standard -a <preencher: nome do app>-uat`) e criar o job no dashboard dele chamando a rota do app (`curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<gerado: host do app UAT>/api/cron/<job>`, com `CRON_SECRET` gravado como segredo, passo 20). Em `-prod` é **R2**. O job roda num dyno avulso, cobrado pelo tempo.
    Verificar: `heroku addons -a <app>` lista o `scheduler` e `heroku logs -a <app> --dyno scheduler` mostra a execução no horário.

### Encerrar

23. [R1] Limpeza periódica do Auth0 de UAT (ex.: a cada mês): se o Heroku destruir um review app antes do `encerrar` rodar (PR parado, destruição por inatividade), a URL dele fica no client de login web do UAT. Comparar a lista de callbacks com os review apps vivos (`heroku pipelines:info <preencher: nome do app> --json`) e remover pelo dashboard do Auth0 as URLs de review apps que não existem mais. Risco baixo: os nomes têm sufixo aleatório e não são reaproveitados.
    Verificar: o app de login web do Auth0 de UAT lista só as URLs fixas e as dos review apps abertos.
24. [R2] Desmontar o host, um recurso por aprovação (destrutivo): remover as variáveis `AUTH0_*` (`gh variable delete <NOME> --repo <preencher: owner/repo>`) e os segredos `HEROKU_API_KEY` e `AUTH0_MGMT_CLIENT_SECRET` (`gh secret delete <NOME> --repo <preencher: owner/repo>`), depois `heroku pipelines:destroy <preencher: nome do app>`, `heroku apps:destroy -a <preencher: nome do app>-uat --confirm <preencher: nome do app>-uat` e o mesmo para `-prod`. O humano revoga o token (`heroku authorizations:revoke <id>`) e o client M2M no Auth0.
    Verificar: `heroku apps --team <preencher: time Heroku>` não lista mais os apps e `gh secret list --repo <preencher: owner/repo>` não lista os nomes removidos.

## Verificação final

- O bloco executado terminou com todos os `Verificar:` ok e o runbook geral que o chamou seguiu.
- Bootstrap: pipeline com review apps automáticos e `-prod` com auto-deploy da `main`; `Regressão (UAT)` de um PR de teste verde contra o review app, com a URL registrada no Auth0 de UAT.
- Custo: dynos Eco/Basic nos apps fixos; review apps só enquanto o PR está aberto.

## Rollback

1. [R1] Desfazer o passo de UAT executado: reapontar o `-uat` para o slug anterior (passo 11).
   Verificar: `heroku releases -a <preencher: nome do app>-uat -n 1` mostra o slug anterior.
2. [R2] Desfazer o Bootstrap: bloco **Encerrar** (passo 24), um recurso por aprovação; Prod: bloco **Rollback**.
   Verificar: `heroku apps --team <preencher: time Heroku>` reflete o estado anterior.

## Registro

No runbook geral que chamou o bloco (comentário no PR ou issue `ops`): bloco e passos executados,
apps/releases/slugs, aprovações R2, passos R3 feitos pelo humano. Nunca valores de segredo.
