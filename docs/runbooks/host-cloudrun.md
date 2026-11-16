# Runbook: Host Cloud Run (bootstrap, UAT, Prod, rollback, envs, cron, encerrar)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT, Prod

## Objetivo

Operações do host **Google Cloud Run** da camada de deploy: vale quando o `deploy.config.json` tem
`"host": "cloudrun"`. Os runbooks gerais ([bootstrap-ambientes.md](./bootstrap-ambientes.md),
[deploy-uat.md](./deploy-uat.md), [deploy-prod.md](./deploy-prod.md), [rollback.md](./rollback.md),
[segredos-e-env.md](./segredos-e-env.md), [feature-flags.md](./feature-flags.md)) mantêm o roteiro e
chamam os blocos abaixo — **Bootstrap**, **Bootstrap (pós-envs)**, **UAT**, **Prod**, **Rollback**,
**Segredos e envs**,
**Cron** e **Encerrar**. Execute o bloco que o runbook geral indicar, com o mesmo risco.

O [bootstrap-ambientes.md](./bootstrap-ambientes.md) chama o **Bootstrap** no passo 1 (só a
infraestrutura do host) e o **Bootstrap (pós-envs)** depois de Neon, Auth0, envs e UAT fixo — os
passos que dependem deles.

No Cloud Run, há um **projeto GCP por ambiente** (`<preencher: projeto GCP UAT>`,
`<preencher: projeto GCP Prod>`), cada um com o seu serviço, o seu Artifact Registry e as suas
credenciais de CI:

- **preview do PR**: o `deploy.yml` constrói a imagem no GitHub Actions, envia ao registry do UAT e
  cria uma revisão com a tag `pr-<n>` **sem tráfego** (`--no-traffic`). A URL da tag é
  `https://pr-<n>---<serviço>-<hash>.<sufixo>.run.app`. Com o PR fechado, a tag sai;
- **UAT fixo**: a tag `uat` movida para a revisão em aceite;
- **Prod**: o push na `main` reconstrói a imagem e põe 100% do tráfego na revisão nova.

O CI entra por **Workload Identity Federation** (sem chave guardada no GitHub). Ele só publica
imagem e revisão. As envs e os segredos do app ficam **no serviço**, configurados pelo humano, e as
revisões novas os herdam. `min-instances=0` em todos os serviços. O preview é **público** e
protegido pela autenticação fail-closed do app.

**Auth0 de UAT (decisão da Task 0 da camada de deploy).** O hash da URL é do projeto, então um
curinga cobre só as revisões do próprio serviço. O client de login web do Auth0 de UAT recebe o
padrão `https://pr-*---<serviço>-<hash>.<sufixo>.run.app`, configurado à mão no passo 9, sem código.

## Pré-condições

- Conta Google com uma **conta de faturamento** `<preencher: id da conta de faturamento>` e permissão para criar projetos.
- CLI `gcloud` autenticada pelo humano (`gcloud auth login`; o agente não faz login por ninguém) e `docker` local só se for testar a imagem.
- O `next.config` do projeto com `output: 'standalone'` (a imagem do modelo usa `.next/standalone`).
- O `next build` da imagem roda **sem nenhuma env** (as envs do app ficam no serviço). Se o app valida env no build (ex.: Zod no `next.config`), declare `ARG NOME` e `ENV NOME=$NOME` antes do `RUN npm run build` no `Dockerfile` e passe `--build-arg NOME=<valor>` no `docker build` (só valores não secretos; segredo nunca vira build arg). O workflow do template não passa build args: o ajuste do `deploy.yml` é do projeto.
- Humano com admin no repositório e no tenant Auth0 de UAT.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir a conta `gcloud`: `gcloud auth list --filter=status:ACTIVE --format='value(account)'` → `<preencher: conta Google>`.
3. [R0] Conferir os projetos (fora do Bootstrap): `gcloud projects describe <preencher: projeto GCP UAT> --format='value(projectId)'` e o mesmo para `<preencher: projeto GCP Prod>` respondem; nunca rode um passo de UAT com `--project` de Prod.

## Passos

### Bootstrap

Repita os passos 1–5 para cada ambiente: `<proj>` = `<preencher: projeto GCP UAT>` e depois `<preencher: projeto GCP Prod>`.

1. [R2] Criar o projeto e ligar o faturamento: `gcloud projects create <proj>` e `gcloud billing projects link <proj> --billing-account <preencher: id da conta de faturamento>`.
   Verificar: `gcloud billing projects describe <proj> --format='value(billingEnabled)'` → `True`.
2. [R2] Criar o **alerta de orçamento** do projeto: `gcloud billing budgets create --billing-account <preencher: id da conta de faturamento> --display-name <proj>-orcamento --budget-amount <preencher: valor mensal, ex. 10USD> --filter-projects projects/<proj> --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0`. O orçamento só avisa (e-mail aos admins da conta de faturamento); não desliga nada.
   Verificar: `gcloud billing budgets list --billing-account <preencher: id da conta de faturamento>` lista `<proj>-orcamento`.
3. [R2] Ligar as APIs: `gcloud services enable run.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com --project <proj>`.
   Verificar: `gcloud services list --enabled --project <proj>` lista as três.
4. [R2] Criar o Artifact Registry com a **política de limpeza** (apagar imagens com mais de 30 dias e as `pr-*` com mais de 14 dias, sempre mantendo as 20 versões mais novas — `Keep` vence `Delete`, então o rollback para qualquer uma das 20 últimas imagens funciona; uma regra só de `Keep` não apaga nada). A tag `uat` do Cloud Run é tag de **revisão**, não de imagem, então a política não consegue protegê-la por tag: a janela longa e o `Keep` das 20 mais novas reduzem o risco, mas uma revisão aceita há mais de 30 dias (e com mais de 20 pushes depois) perde a imagem e falha no cold start (`min-instances=0`). Recuperação: reexecutar o `Deploy` do PR (ou um push novo) para reconstruir a imagem, e reapontar a tag `uat`: `gcloud artifacts repositories create <preencher: repositório, ex. app> --repository-format docker --location <preencher: região, ex. us-east1> --project <proj>` e `gcloud artifacts repositories set-cleanup-policies <preencher: repositório, ex. app> --location <preencher: região, ex. us-east1> --project <proj> --policy limpeza.json --no-dry-run`, com o `limpeza.json`:

   ```json
   [
     {
       "name": "apagar-velhas",
       "action": { "type": "Delete" },
       "condition": { "tagState": "any", "olderThan": "30d" }
     },
     {
       "name": "pr-velhas",
       "action": { "type": "Delete" },
       "condition": { "tagState": "tagged", "tagPrefixes": ["pr-"], "olderThan": "14d" }
     },
     {
       "name": "manter-20",
       "action": { "type": "Keep" },
       "mostRecentVersions": { "keepCount": 20 }
     }
   ]
   ```

   Verificar: `gcloud artifacts repositories describe <preencher: repositório, ex. app> --location <preencher: região, ex. us-east1> --project <proj>` mostra as três políticas (`gcloud artifacts repositories list-cleanup-policies <preencher: repositório, ex. app> --location <preencher: região, ex. us-east1> --project <proj>`).

5. [R2] Criar o pool/provider WIF e a service account do deploy: `gcloud iam workload-identity-pools create github --location global --project <proj>`; `gcloud iam workload-identity-pools providers create-oidc github --location global --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com --attribute-mapping google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref --attribute-condition <condição> --project <proj>`, com `<condição>` = `"assertion.repository == '<preencher: owner/repo>'"` no projeto de UAT e `"assertion.repository == '<preencher: owner/repo>' && assertion.ref == 'refs/heads/main'"` no de **Prod** (sem a trava da `main`, o workflow de um PR conseguiria publicar em Prod sem o merge); `gcloud iam service-accounts create deployer --project <proj>`; os papéis `roles/run.admin`, `roles/artifactregistry.writer` e `roles/iam.serviceAccountUser` para `deployer@<proj>.iam.gserviceaccount.com` (`gcloud projects add-iam-policy-binding <proj> --member serviceAccount:deployer@<proj>.iam.gserviceaccount.com --role <papel>`, um por papel); e o vínculo do repositório: `gcloud iam service-accounts add-iam-policy-binding deployer@<proj>.iam.gserviceaccount.com --role roles/iam.workloadIdentityUser --member principalSet://iam.googleapis.com/projects/<número do projeto>/locations/global/workloadIdentityPools/github/attribute.repository/<preencher: owner/repo> --project <proj>`.
   Verificar: `gcloud iam workload-identity-pools providers describe github --location global --workload-identity-pool github --project <proj> --format='value(name)'` devolve `projects/<número do projeto>/locations/global/workloadIdentityPools/github/providers/github` (é o `wifProvider` do passo 6) e, no de Prod, `--format='value(attributeCondition)'` contém `refs/heads/main`.

Depois dos dois ambientes:

6. [R1] Copiar os modelos e criar o `deploy.config.json` por PR: `cp scripts/deploy/templates/cloudrun/Dockerfile scripts/deploy/templates/cloudrun/.dockerignore .`; pôr `output: 'standalone'` no `next.config`; o `COPY public` do `Dockerfile` falha se o projeto não tem `public/` — crie a pasta (com um `.gitkeep`) ou remova a linha. O `deploy.config.json` (nada aqui é segredo):

   ```json
   {
     "host": "cloudrun",
     "cloudrun": {
       "region": "<preencher: região, ex. us-east1>",
       "repository": "<preencher: repositório, ex. app>",
       "uat": {
         "project": "<preencher: projeto GCP UAT>",
         "service": "<preencher: serviço, ex. app>",
         "wifProvider": "<gerado: wifProvider do UAT>",
         "serviceAccount": "deployer@<preencher: projeto GCP UAT>.iam.gserviceaccount.com"
       },
       "prod": {
         "project": "<preencher: projeto GCP Prod>",
         "service": "<preencher: serviço, ex. app>",
         "wifProvider": "<gerado: wifProvider de Prod>",
         "serviceAccount": "deployer@<preencher: projeto GCP Prod>.iam.gserviceaccount.com"
       }
     }
   }
   ```

   Verificar: `node scripts/deploy/index.mjs host` não falha e `docker build -t teste .` termina sem erro.

7. [R2] Primeiro deploy da `main` em cada ambiente (cria o serviço; sem ele, o `deploy.yml` do PR falha com "rode o Bootstrap de docs/runbooks/host-cloudrun.md"): construir e enviar a imagem (`docker build --platform linux/amd64 -t <preencher: região, ex. us-east1>-docker.pkg.dev/<proj>/<preencher: repositório, ex. app>/<preencher: serviço, ex. app>:bootstrap .` e `docker push` da mesma imagem, com `gcloud auth configure-docker <preencher: região, ex. us-east1>-docker.pkg.dev` antes) e `gcloud run deploy <preencher: serviço, ex. app> --image <a imagem> --region <preencher: região, ex. us-east1> --project <proj> --allow-unauthenticated --min-instances 0`. O tráfego fica 100% nesta revisão. O `--platform linux/amd64` é obrigatório num Mac Apple Silicon: sem ele a imagem sai `arm64` e o Cloud Run, que só roda `linux/amd64`, recusa o deploy (o CI já constrói em `amd64`).
   Verificar: `gcloud run services describe <preencher: serviço, ex. app> --region <preencher: região, ex. us-east1> --project <proj> --format='value(status.url)'` devolve a URL e a revisão fica `Ready` (sem as envs, que chegam pelo bootstrap-ambientes.md, login e rotas com banco ainda falham).

### Bootstrap (pós-envs)

Depende do `DATABASE_URL` do Neon, dos tenants Auth0 e das envs do serviço (passos 2–7 do
bootstrap-ambientes.md).

8. [R0] Conferir as envs e os segredos gravados **no serviço** de cada ambiente pelos passos 4–7 do bootstrap-ambientes.md (bloco **Segredos e envs**), incluindo `APP_ENV=uat` no UAT e `APP_ENV=production` em Prod. Faltando alguma → voltar ao [segredos-e-env.md](./segredos-e-env.md) antes do primeiro PR.
   Verificar: `gcloud run services describe <preencher: serviço, ex. app> --region <preencher: região, ex. us-east1> --project <proj> --format='value(spec.template.spec.containers[0].env[].name)'` lista os nomes esperados.
9. [R2] No app de login web do Auth0 de UAT, aceitar as URLs de preview e a da tag `uat` (callback `/api/auth/callback` e logout): o curinga `https://pr-*---<preencher: serviço, ex. app>-<gerado: hash do serviço UAT>.<gerado: sufixo da região>.run.app` (o hash e o sufixo saem da URL do passo 7) e a URL fixa `https://uat---<preencher: serviço, ex. app>-<gerado: hash do serviço UAT>.<gerado: sufixo da região>.run.app`. No tenant de Prod, só a URL de Prod, sem curinga.
   Verificar: o login pelo Universal Login funciona na URL de um preview `pr-<n>`.

### UAT

10. [R0] Localizar a revisão do PR: `gcloud run services describe <preencher: serviço, ex. app> --region <preencher: região, ex. us-east1> --project <preencher: projeto GCP UAT> --format=json | jq '.status.traffic[] | select(.tag == "pr-<n>")'` (ou o comentário do `github-actions[bot]` com o alvo da `Regressão (UAT)`).
    Verificar: a tag `pr-<n>` aponta para uma revisão com a URL do preview; anotar `<revisão>` e, para reverter, a revisão atual da tag `uat` (`select(.tag == "uat")`).
11. [R1] Apontar o UAT fixo para a revisão do PR: `gcloud run services update-traffic <preencher: serviço, ex. app> --update-tags uat=<revisão> --region <preencher: região, ex. us-east1> --project <preencher: projeto GCP UAT>`. Só move a tag; o tráfego do serviço não muda.
    Verificar: `curl -s -o /dev/null -w '%{http_code}' https://uat---<preencher: serviço, ex. app>-<gerado: hash do serviço UAT>.<gerado: sufixo da região>.run.app/` → `200` e o `describe` do passo 10 mostra `uat` → `<revisão>`.
12. [R1] Reverter o UAT fixo: `gcloud run services update-traffic <preencher: serviço, ex. app> --update-tags uat=<revisão-anterior> --region <preencher: região, ex. us-east1> --project <preencher: projeto GCP UAT>`.
    Verificar: o `describe` do passo 10 mostra `uat` → `<revisão-anterior>` e a home responde `200`.

A URL do UAT deste host é `https://uat---<preencher: serviço, ex. app>-<gerado: hash do serviço UAT>.<gerado: sufixo da região>.run.app`.

### Prod

13. [R0] Anotar a revisão de Prod atual (alvo do rollback): `gcloud run services describe <preencher: serviço, ex. app> --region <preencher: região, ex. us-east1> --project <preencher: projeto GCP Prod> --format='value(status.traffic[0].revisionName)'`.
    Verificar: a revisão anotada tem 100% do tráfego; anotar `<revisão-atual>`.
14. [R0] Acompanhar o deploy de Produção: `gh run list --workflow deploy.yml --branch main --limit 1` e `gh run watch <run-id>`.
    Verificar: o job `Deploy` do `mergeCommit` fica verde e `gcloud run revisions list --service <preencher: serviço, ex. app> --region <preencher: região, ex. us-east1> --project <preencher: projeto GCP Prod> --limit 1` mostra a revisão nova com a imagem `main-<sha7>` (falhou → [rollback.md](./rollback.md)).
15. [R0] Observar erros por alguns minutos: `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="<preencher: serviço, ex. app>" AND severity>=ERROR' --project <preencher: projeto GCP Prod> --freshness 15m --limit 50`.
    Verificar: sem pico de erros 5xx novos (havendo → [rollback.md](./rollback.md)).

A URL de Prod deste host é `https://<preencher: domínio de Prod>`.

### Rollback

16. [R0] Identificar a revisão atual e a anterior saudável: `gcloud run revisions list --service <preencher: serviço, ex. app> --region <preencher: região, ex. us-east1> --project <preencher: projeto GCP Prod> --limit 5` e diagnosticar com o `gcloud logging read` do passo 15.
    Verificar: `<revisão-atual>` e `<revisão-anterior>` anotadas; a feature/commit suspeito está identificado.
17. [R2] Voltar o tráfego para a revisão anterior saudável: `gcloud run services update-traffic <preencher: serviço, ex. app> --to-revisions <revisão-anterior>=100 --region <preencher: região, ex. us-east1> --project <preencher: projeto GCP Prod>`. O próximo push na `main` (o revert) volta a mover o tráfego para a revisão nova (`--to-latest` no `deploy.yml`).
    Verificar: o `describe` do passo 13 mostra `<revisão-anterior>` com 100% e o smoke test passa.
18. [R2] Se o rollback piorou o cenário, voltar à revisão anotada: `gcloud run services update-traffic <preencher: serviço, ex. app> --to-revisions <revisão-atual>=100 --region <preencher: região, ex. us-east1> --project <preencher: projeto GCP Prod>`.
    Verificar: o `describe` do passo 13 mostra `<revisão-atual>` com 100%.

### Segredos e envs

As envs ficam **no serviço** de cada ambiente; toda mudança cria uma revisão nova. No serviço de
Prod a revisão nova recebe o tráfego. No de UAT o tráfego não importa (o acesso é por tag), mas os
previews e a tag `uat` continuam nas revisões antigas até o próximo push do PR ou o passo 11. O CI
nunca passa `--set-env-vars`.

19. [R0] Listar as envs do serviço (só nomes): `gcloud run services describe <preencher: serviço, ex. app> --region <preencher: região, ex. us-east1> --project <proj> --format='value(spec.template.spec.containers[0].env[].name)'`.
    Verificar: a saída tem só nomes (o `describe` sem `--format` mostra os valores, R3).
20. [R2] Env **não-secreta**: `gcloud run services update <preencher: serviço, ex. app> --update-env-vars <NOME>=<valor> --region <preencher: região, ex. us-east1> --project <proj>` (ex.: `APP_ENV`, flags `on`/`off`). R2 também no UAT: cria revisão e, no serviço de UAT, muda a revisão que recebe o tráfego do serviço.
    Verificar: o passo 19 lista `<NOME>` e `gcloud run revisions list --service <preencher: serviço, ex. app> --region <preencher: região, ex. us-east1> --project <proj> --limit 1` mostra a revisão nova `Ready`.
21. [R2] **Segredo** (criar ou rotacionar): o agente pede ao humano que, **num terminal separado, fora da sessão do agente** (ou pelo console, _Cloud Run → serviço → Editar e implantar nova revisão → Variáveis_), rode `read -s VALOR` (digita o valor sem eco), depois `gcloud run services update <preencher: serviço, ex. app> --update-env-vars <NOME>="$VALOR" --region <preencher: região, ex. us-east1> --project <proj>` e, por fim, `unset VALOR`. O valor nunca aparece em linha de comando com literal nem no histórico; nunca pelo prefixo `!` da sessão. (Fica como env do serviço, fora do Secret Manager e da sua cota.)
    Verificar: o passo 19 lista `<NOME>` e a revisão nova fica `Ready`.
22. [R2] Remover uma env: `gcloud run services update <preencher: serviço, ex. app> --remove-env-vars <NOME> --region <preencher: região, ex. us-east1> --project <proj>`.
    Verificar: o passo 19 não lista mais `<NOME>`.
23. [R1] No UAT, levar a env nova para o preview de um PR aberto: push na branch do PR (o `deploy.yml` cria revisão nova a partir do serviço) e, se for o UAT fixo, o passo 11.
    Verificar: a `Regressão (UAT)` do PR roda contra a revisão nova (o comentário do bot traz a URL `pr-<n>`).

### Cron

24. [R1] No UAT, criar o job do **Cloud Scheduler** chamando a rota do app (até 3 jobs grátis por conta de faturamento): `gcloud services enable cloudscheduler.googleapis.com --project <preencher: projeto GCP UAT>` e `gcloud scheduler jobs create http <job> --schedule '<preencher: expressão cron>' --uri https://uat---<preencher: serviço, ex. app>-<gerado: hash do serviço UAT>.<gerado: sufixo da região>.run.app/api/cron/<job> --http-method POST --location <preencher: região, ex. us-east1> --project <preencher: projeto GCP UAT>`. O cabeçalho com o `CRON_SECRET` é posto pelo humano no console (_Cloud Scheduler → job → Editar → Cabeçalhos_), nunca em linha de comando. Em Prod é **R2**.
    Verificar: `gcloud scheduler jobs describe <job> --location <preencher: região, ex. us-east1> --project <proj> --format='value(state)'` → `ENABLED` e, após o horário, `gcloud scheduler jobs describe <job> --location <preencher: região, ex. us-east1> --project <proj> --format='value(status)'` sem erro.

### Encerrar

25. [R1] Encerrar à mão o preview de um PR (o `deploy.yml` faz isto ao fechar o PR): `gcloud run services update-traffic <preencher: serviço, ex. app> --remove-tags pr-<n> --region <preencher: região, ex. us-east1> --project <preencher: projeto GCP UAT>`.
    Verificar: o `describe` do passo 10 não mostra mais a tag `pr-<n>`.
26. [R2] Desmontar o host, um recurso por aprovação (destrutivo): `gcloud run services delete <preencher: serviço, ex. app> --region <preencher: região, ex. us-east1> --project <proj>` em cada ambiente e, se o projeto GCP só existe para isto, `gcloud projects delete <proj>` (fica 30 dias recuperável; leva junto registry, WIF e jobs). Remover o orçamento: `gcloud billing budgets delete <id do orçamento> --billing-account <preencher: id da conta de faturamento>`.
    Verificar: `gcloud projects describe <proj> --format='value(lifecycleState)'` → `DELETE_REQUESTED` (ou o serviço não aparece em `gcloud run services list --project <proj>`).

## Verificação final

- O bloco executado terminou com todos os `Verificar:` ok e o runbook geral que o chamou seguiu.
- Bootstrap: dois projetos com faturamento, alerta de orçamento, registry com limpeza, WIF e o serviço criado; `deploy.config.json` preenchido; `Regressão (UAT)` de um PR de teste verde contra a URL `pr-<n>`.
- Custo: `min-instances=0` em todos os serviços (sem tráfego, sem cobrança de CPU); registry limpo pela política.

## Rollback

1. [R1] Desfazer o passo de UAT executado: reapontar a tag `uat` para a revisão anterior (passo 12).
   Verificar: o `describe` do passo 10 mostra `uat` → `<revisão-anterior>`.
2. [R2] Desfazer o Bootstrap: bloco **Encerrar** (passo 26), um recurso por aprovação; Prod: bloco **Rollback**.
   Verificar: `gcloud projects list --filter='projectId:<proj>'` reflete o estado anterior.

## Registro

No runbook geral que chamou o bloco (comentário no PR ou issue `ops`): bloco e passos executados,
projetos/revisões/tags, aprovações R2, passos R3 feitos pelo humano. Nunca valores de segredo.
