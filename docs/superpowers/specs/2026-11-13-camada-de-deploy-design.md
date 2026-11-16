# Spec: Camada de deploy — Vercel, Heroku e Cloud Run no mesmo fluxo

**Data**: 2026-11-13
**Status**: Aprovada (2026-11-15; sem cenários `CT-` — infraestrutura do template, ver §8)
**Autor(es)**: Fabio Schiozer + Claudinho

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano e a implementação.
> Marcado _(decisão do Claudinho)_ = escolha do agente que o humano pode revisar.

## 1. Contexto e Objetivo

O template assume a **Vercel** como host. A empresa do humano passou a bloquear Vercel, Netlify,
Replit, Railway, Render, Fly.io e StackBlitz, e os 4 projetos derivados (AssistBru.ai,
ContasMes.ai, EvoluiAI, PerformaRM — todos `completo-direto`, último sync v0.2.0) rodam na Vercel.
O humano tem conta pessoal no Heroku e pode usar Google Cloud (Cloud Run) com conta pessoal.

**Objetivo**: o template passa a aceitar **três hosts equivalentes — Vercel, Heroku e Cloud Run** —
escolhidos por projeto, mantendo o fluxo do ADR-002 sem mudança para quem usa:

- PR aberto/atualizado → **preview próprio do PR** (cada PR tem o seu; dois PRs abertos não
  disputam o mesmo ambiente) + `Regressão (UAT)` contra ele (ADR-016);
- endereço **fixo de UAT** para o aceite humano e para conectar o ChatGPT (MCP);
- merge na `main` → Prod; rollback por runbook (ADR-013).

O template sai pronto; **migrar ou não** cada projeto é decisão posterior do humano.

**Hoje a Vercel está acoplada em**: `scripts/e2e/wait-preview.mjs` (espera o deployment
`Preview*` no GitHub), `tests/e2e/support/env.ts` + `test.ts` (bypass da Deployment Protection),
`.github/workflows/e2e-regressao.yml` (passo e segredo do bypass), `examples/walking-skeleton/src/shared/appEnv.ts`
(`!env.VERCEL` na regra fail-closed do E2E local), os runbooks `bootstrap-ambientes`, `deploy-uat`,
`deploy-prod`, `rollback`, `segredos-e-env`, `e2e-uat-configurar`, e menções em `ARCHITECTURE.md`
(Vercel Cron), `docs/guides/deploy-ci-guide.md` e nos commands `deploy-staging`/`deploy-prod`.

## 2. Não-Objetivos

- **Migrar os 4 projetos.** Fica para o humano, projeto a projeto, pelo runbook de migração (§6.6).
- **Armazenamento de arquivos** (Vercel Blob do PerformaRM) — não é deploy; fica para outra spec.
- **Mudar banco ou auth**: Neon (ADR-003) e Auth0 (ADR-004) seguem iguais nos três hosts.
- **Skill de init** (perguntar a stack ao adotar o template) — brainstorming e spec separados,
  depois desta; ela só vai **escrever** o `deploy.config.json` definido aqui.
- **Feature toggle**: não há. O próprio `deploy.config.json` é a chave, com padrão `vercel`
  (decisão do humano).
- Outros hosts (Cloudflare, Amplify, Azure…): o contrato permite somar depois, não agora.
- Adaptar o código de app dos projetos (ex.: a API Hono do AssistBru escrita para `@vercel/node`).

## 3. Fluxo de quem usa

1. **Escolher o host** — `deploy.config.json` na raiz (§5.1). Ausente → `vercel` (os 4 projetos
   continuam funcionando sem tocar em nada depois do próximo `/template-sync`).
2. **Bootstrap** — runbook `bootstrap-ambientes.md`, que manda para o bloco **Bootstrap** do runbook
   do host (§6.4). Cria os ambientes UAT/Prod no host, liga ao GitHub e ao Neon/Auth0 de cada ambiente.
3. **Abrir PR** — o preview do PR nasce (pelo host ou pelo CI, conforme o host); o job
   `Regressão (UAT)` espera a URL pela camada (§5.3) e roda o Playwright contra ela.
4. **Aceite** — `deploy-uat.md` aponta o **UAT fixo** para o preview do PR (bloco do host).
5. **Merge** (humano) — Prod é atualizada; `deploy-prod.md` acompanha e faz o smoke test.
6. **Incidente** — `rollback.md` (flag → versão anterior → revert), com os comandos do host.
7. **PR fechado** — o preview do PR é removido (pelo host ou pelo CI).

## 4. Abordagens consideradas

| | Abordagem | Prós | Contras |
|---|---|---|---|
| **A (escolhida)** | **Adaptadores em script (`scripts/deploy/`), escolhidos por `deploy.config.json`** | Testável no Vitest, como o resto dos scripts; a skill de init só escreve um arquivo; somar um host = um adaptador | Mais código Node no template |
| B | Composite actions por host (`.github/actions/deploy-<host>`) | Menos código; usa as actions oficiais | Lógica em YAML sem teste unitário; o bypass do E2E segue em código à parte |
| C | Só documentar os três hosts, CI preso à Vercel | Quase zero trabalho | Heroku/Cloud Run ficam sem `Regressão (UAT)`, obrigatória pelo ADR-016 |

O humano escolheu **A**.

## 5. Desenho

### 5.1 `deploy.config.json`

```json
{
  "host": "cloudrun",
  "cloudrun": {
    "region": "us-east1",
    "repository": "app",
    "uat": {
      "project": "app-uat",
      "service": "app",
      "wifProvider": "projects/123/locations/global/workloadIdentityPools/github/providers/github",
      "serviceAccount": "deployer@app-uat.iam.gserviceaccount.com"
    },
    "prod": {
      "project": "app-prod",
      "service": "app",
      "wifProvider": "projects/456/locations/global/workloadIdentityPools/github/providers/github",
      "serviceAccount": "deployer@app-prod.iam.gserviceaccount.com"
    }
  }
}
```

- `repository` é o nome do Artifact Registry, **um por projeto GCP** (cada ambiente tem o seu,
  com o mesmo nome). Provider e service account do Workload Identity Federation não são segredos
  e ficam aqui, por ambiente — _(decisão do Claudinho)_.

- `host`: `vercel` | `heroku` | `cloudrun`. Arquivo ausente ≡ `{ "host": "vercel" }`.
- Bloco do host com **identificadores não secretos** (nomes de projeto/app/serviço/região).
  Vercel e Heroku não precisam de bloco no CI (o host faz o deploy); se existir, só documenta.
- Validação em `scripts/deploy/config.mjs` (o tooling da raiz não tem Zod — ADR-007): host
  desconhecido, bloco obrigatório ausente ou campo vazio → erro com a mensagem do campo.
- **Segredos nunca vão neste arquivo** (ADR-013 §4).

### 5.2 Contrato do adaptador

`scripts/deploy/hosts/<host>.mjs`, cada um exporta o mesmo objeto; `scripts/deploy/index.mjs` lê a
config, escolhe o adaptador e expõe uma CLI (`node scripts/deploy/index.mjs <operação>`):

| Operação | Quem chama | Vercel | Heroku | Cloud Run |
|---|---|---|---|---|
| `deployPreview` | `deploy.yml` (PR aberto/atualizado) | no-op (host faz) | no-op (review app do pipeline) | build da imagem + `gcloud run deploy --tag pr-<n> --no-traffic` + publica GitHub Deployment `Preview` com a URL da tag |
| `aguardarPreview` | `e2e-regressao.yml` | espera o GitHub Deployment `Preview*` do SHA (código atual do `wait-preview`) | espera o GitHub Deployment do review app do SHA | espera o GitHub Deployment `Preview` publicado pelo `deployPreview` |
| `cabecalhosDeAcesso` | `tests/e2e/support` | bypass da Deployment Protection (atual) | `null` | `null` |
| `deployProd` | `deploy.yml` (push na `main`) | no-op (host faz) | no-op (auto-deploy da `main` no app de Prod) | deploy da revisão + 100% do tráfego no serviço de Prod |
| `encerrarPreview` | `deploy.yml` (PR fechado) | no-op | no-op (o pipeline apaga o review app) | remove a tag `pr-<n>` |

- **`aguardarPreview` é um só mecanismo**: a API de Deployments do GitHub. O `waitPreview` atual
  vira genérico, recebendo do adaptador o **predicado de ambiente** (Vercel: `startsWith('Preview')`;
  Heroku e Cloud Run: o nome que cada um publica). Timeout, intervalo e retentativas não mudam.
- **UAT fixo e rollback não entram no contrato de CI**: são operações com aprovação humana
  (R1/R2) e ficam nos runbooks do host (§6.4) — _(decisão do Claudinho)_.
- O `wait-preview.mjs` antigo continua existindo como fachada para `aguardarPreview` por uma
  Release (projetos com workflow customizado não quebram no sync) — _(decisão do Claudinho)_.

### 5.3 Workflows

- **Novo `deploy.yml`**: `pull_request` (`opened`, `synchronize`, `reopened`, `closed`) e `push` na
  `main`. Um passo `node scripts/deploy/index.mjs <op>`; com host `vercel`/`heroku` o job termina
  em segundos (no-op). Credencial do Cloud Run por **Workload Identity Federation**
  (`google-github-actions/auth`), sem chave guardada no GitHub. PR de fork não roda o deploy
  (mesma regra do `e2e-regressao.yml`).
- **`e2e-regressao.yml`**: o passo "Aguardar o deploy Preview da Vercel" vira "Aguardar o preview
  do PR" (`aguardarPreview`). O segredo `VERCEL_AUTOMATION_BYPASS_SECRET` continua passado só se
  existir (Vercel); nos outros hosts fica vazio.
- **`requiredChecks`** de `hooks/protect-main/config.json`: o `deploy.yml` **não** entra como check
  obrigatório (ele é no-op em 2 dos 3 hosts; quem bloqueia é a `Regressão (UAT)`) — _(decisão do Claudinho)_.

### 5.4 Proteção do preview

- **Vercel**: mantém a Deployment Protection + bypass, como hoje.
- **Heroku e Cloud Run**: preview **público**, protegido pela autenticação fail-closed do próprio
  app (o mesmo que já vale para o alias do UAT na Vercel, que é aberto para o aceite e o ChatGPT).
  Sem ID token nem basic auth — _(decisão do Claudinho; mantém o E2E e o MCP iguais nos três)_.
- `env.ts`: `bypass` passa a vir de `cabecalhosDeAcesso` do host; a regra de "só para a origem do
  `baseURL`" (`origemDoAlvo`) não muda.

### 5.5 Variáveis do runtime

- A regra fail-closed do E2E local (`appEnv.ts` do exemplo) passa de `!env.VERCEL` para **"não está
  em nenhum host"**: `!env.VERCEL && !env.DYNO && !env.K_SERVICE` (variáveis que cada plataforma
  define sozinha, que ninguém esquece de configurar) — _(decisão do Claudinho)_.
- `APP_ENV` (`uat`/`production`) continua sendo a variável neutra que o app lê; cada runbook de host
  diz onde configurá-la.

### 5.6 Por host

**Vercel** — como hoje: integração Git da Vercel, Preview por PR, alias fixo de UAT, Prod no merge,
`vercel rollback`/`promote`. Cron: Vercel Cron.

**Heroku** — um **pipeline** com: review apps (um por PR, criados e apagados pelo pipeline; exigem
`app.json`), app `<nome>-uat` (UAT fixo: recebe o build do PR em aceite) e app `<nome>-prod`
(auto-deploy da `main`). Next.js pelo buildpack Node (`Procfile`: `web: npm start`, porta via
`PORT`). Envs com `heroku config:set` por app. Rollback: `heroku releases:rollback`. Cron:
Heroku Scheduler. Custo: dynos Eco/Basic, review app só enquanto o PR está aberto.

**Cloud Run** — um projeto GCP por ambiente (`<app>-uat`, `<app>-prod`) na mesma conta de
faturamento pessoal, com **alerta de orçamento**. Imagem construída no GitHub Actions (não no Cloud
Build), enviada ao Artifact Registry com **política de limpeza** (só as últimas imagens; as de
`pr-*` somem após o PR fechar). Preview = revisão com tag `pr-<n>` sem tráfego; UAT fixo = tag
`uat` movida para a revisão em aceite; Prod = 100% do tráfego. `min-instances=0` em todos os
serviços. Envs e segredos do app configurados **no serviço** pelo humano
(`gcloud run services update --update-env-vars`), nunca pelo CI — o CI só publica imagem e
revisão _(decisão do Claudinho: mantém o CI sem segredo do app e fica fora da cota do Secret Manager)_.
Rollback: `gcloud run services update-traffic --to-revisions <anterior>=100`. Cron: Cloud Scheduler
chamando uma rota HTTP (até 3 jobs grátis por conta). Next.js com `output: 'standalone'` e um
`Dockerfile`.

**Decisões de construção** _(do Claudinho, a partir do builder check)_:

- **Heroku → URL do review app**: a 1ª tarefa do plano verifica num app de teste se a integração
  GitHub do pipeline publica um GitHub Deployment com a URL do review app. Se publicar, o
  `aguardarPreview` usa o mesmo mecanismo dos outros hosts (o predicado de ambiente sai dessa
  constatação). Se não, o adaptador consulta a Platform API do Heroku (`GET /review-apps` do
  pipeline, filtrando pelo SHA) com o segredo `HEROKU_API_KEY` só no GitHub — a spec já prevê
  essa ramificação; o plano traz as duas como tarefa condicional.
- **Heroku → UAT fixo**: o app `-uat` recebe o **slug** do review app do PR em aceite
  (`POST /apps/<app>-uat/releases` com o `slug` da última release do review app), sem rebuild.
  Rollback do UAT = `heroku releases:rollback -a <app>-uat`.
- **Cloud Run → Prod reconstrói a partir da `main`** (como a Vercel e o Heroku já fazem). Com
  squash merge o commit da `main` é outro, e a imagem testada no UAT é a do PR; o que garante o
  "testado = o que vai para Prod" é o PR atualizado com a `main` antes do merge (o `PR gate`
  e o `mergeStateStatus: CLEAN` do `deploy-prod.md`). Cada projeto GCP tem o seu registry; não há
  pull entre projetos.
- **Cloud Run → limpeza do registry**: manter as 5 imagens mais novas por projeto e apagar as
  tags `pr-*` com mais de 7 dias (política do Artifact Registry criada no bootstrap).
- **Cloud Run → primeiro deploy**: o bloco **Bootstrap** de `host-cloudrun.md` cria o serviço em
  cada ambiente com um deploy normal da `main` (tráfego 100%), e o humano configura as envs do
  app no serviço **antes** do primeiro PR. Revisões novas herdam as envs do serviço, então o
  `deployPreview` não precisa de segredo. O `deployPreview` falha com mensagem clara se o serviço
  não existir ("rode o Bootstrap de host-cloudrun.md").
- **Auth0 sem curinga**: se a constatação do §6.5 for negativa, o plano já inclui a alternativa
  (Management API no `deployPreview`/`encerrarPreview`) como tarefa condicional.

Os arquivos que a plataforma exige na raiz (`app.json` + `Procfile` no Heroku, `Dockerfile` +
`.dockerignore` no Cloud Run) ficam como modelos em `scripts/deploy/templates/<host>/` e o
bootstrap do host os copia para a raiz — o template não carrega na raiz arquivos de um host que o
projeto não usa _(decisão do Claudinho)_.

## 6. Documentação

### 6.1 ADR

**ADR-018 — Camada de deploy plugável** (`docs/adr/template/018-camada-de-deploy.md`): contexto
(bloqueio corporativo, 4 projetos), decisão (§4–§5), consequências (custos e limites de cada host),
alternativas (B e C acima; Cloudflare/Amplify/Azure como hosts futuros). O ADR-002 ganha uma linha
apontando para o ADR-018 (o host já estava "fora de escopo" lá).

### 6.2 Arquivos que mudam de "Vercel" para "host"

`ARCHITECTURE.md` (Vercel Cron → "cron do host"; tabela de stack de exemplo cita os três),
`docs/guides/deploy-ci-guide.md`, `.claude/commands/deploy-staging.md` e `deploy-prod.md`,
`CLAUDE.md` (nota de adoção: escolher o host no `deploy.config.json`; regra 9 sem citar Vercel).

### 6.3 Runbooks gerais (ficam neutros)

`bootstrap-ambientes`, `deploy-uat`, `deploy-prod`, `rollback`, `segredos-e-env`,
`e2e-uat-configurar`: mantêm o roteiro, as classes de risco e as verificações; cada passo que hoje
é um comando `vercel …` vira "executar o bloco **<Operação>** do runbook do host" com o mesmo risco.

### 6.4 Runbooks de host (novos)

`docs/runbooks/host-vercel.md`, `host-heroku.md`, `host-cloudrun.md`, cada um com os blocos
**Bootstrap**, **UAT** (apontar o fixo / reverter), **Prod** (acompanhar / smoke test),
**Rollback**, **Segredos e envs**, **Cron** e **Encerrar** (desmontar o ambiente). O conteúdo
Vercel atual é **movido** para `host-vercel.md`, sem mudar comandos. Precisam passar no
`npm run check:runbooks` (o builder ajusta o checker se o formato em blocos exigir).

### 6.5 Auth0 com URL por PR

Cada preview tem uma URL nova, e o Auth0 de UAT precisa aceitá-la no callback/logout (hoje já vale
para a Vercel — `e2e-uat-configurar.md`). **Primeira tarefa do plano**: verificar se o Auth0 aceita
um padrão que cubra as URLs de cada host (`*.herokuapp.com`, `pr-*---<serviço>.run.app`).
Se não aceitar, o runbook do host documenta a alternativa (registrar a URL do PR no Auth0 de UAT
pelo `deployPreview`/`encerrarPreview` com a Management API, segredo só no GitHub) — o builder
traz a constatação de volta antes de implementar a alternativa.

### 6.5.1 Sync dos 4 projetos

Os runbooks gerais dos projetos já têm `<preencher>` resolvidos e datas de `Última verificação`.
A regra do `template-sync` vale ("os valores preenchidos do projeto prevalecem; só a estrutura
nova entra"), mas aqui a estrutura **muda de lugar**: os valores Vercel de `deploy-uat.md` etc.
passam a morar em `host-vercel.md`. A skill `template-sync` ganha uma nota para esta Release:
**levar os valores preenchidos dos runbooks gerais para `host-vercel.md`** e listar a mudança no
PR de sync (seção **Juntados**). `deploy.yml`, `scripts/deploy/` e os runbooks de host entram como
arquivos novos do template — _(decisão do Claudinho)_.

### 6.6 Runbook de migração

`docs/runbooks/migrar-host.md`: levar um projeto de um host a outro — bootstrap do host novo em
paralelo, envs, trocar `deploy.config.json` por PR, validar UAT, cortar Prod (DNS/domínio),
desmontar o host antigo. Lista o que é **código do app** e o runbook não cobre (ex.: `@vercel/node`,
`@vercel/blob`, `VERCEL_*` lidas pelo app).

## 7. Requisitos não funcionais

Segue o baseline. Do lado da esteira: o `aguardarPreview` mantém o timeout atual (15 min) nos três
hosts; o `deployPreview` do Cloud Run deve caber nesse prazo.

## 8. Cenários de teste

Feature de **infraestrutura do template**, sem tela nem rota do app: dispensa cenários `@e2e`,
`@sistemico` e `@usabilidade` (nada a cobrir pelo `check:cenarios`). A cobertura é por **Vitest**
em `tests/unit/`, no padrão dos scripts atuais (`e2eWaitPreview.test.ts`, `e2eEnv.test.ts`):

- `config.mjs`: ausente → `vercel`; host inválido; bloco/campo obrigatório ausente.
- `aguardarPreview` de cada host: pronto, falhou, timeout, erro transitório (os testes atuais do
  `wait-preview` passam a rodar contra o adaptador Vercel sem mudar de comportamento).
- `deployPreview`/`deployProd`/`encerrarPreview` do Cloud Run: os comandos `gcloud`/`docker`
  montados (executor injetado, sem rodar nada), a publicação do GitHub Deployment com a URL da tag.
- no-op dos hosts Vercel/Heroku nas operações de deploy.
- `cabecalhosDeAcesso`: bypass só na Vercel com segredo; `null` nos demais.
- `appEnv` do exemplo: e2e local recusado com `VERCEL`, `DYNO` ou `K_SERVICE`.

## 9. Critérios de Aceitação

- **CA-1**: projeto sem `deploy.config.json` se comporta exatamente como hoje (Vercel); os testes
  atuais do E2E e do `wait-preview` passam sem mudança de comportamento.
- **CA-2**: `deploy.config.json` com `heroku` ou `cloudrun` muda o CI e o E2E sem editar workflow.
- **CA-3**: com `cloudrun`, o PR ganha uma revisão `pr-<n>` sem tráfego, a `Regressão (UAT)` roda
  contra ela, o merge põe 100% do tráfego na revisão nova e o PR fechado remove a tag.
- **CA-4**: com `heroku`, a `Regressão (UAT)` espera o review app do SHA e roda contra ele.
- **CA-5**: existem `host-vercel.md`, `host-heroku.md`, `host-cloudrun.md` com todos os blocos do
  §6.4; os runbooks gerais não têm comando de host; `npm run check:runbooks` passa.
- **CA-6**: ADR-018 criado; `ARCHITECTURE.md`, `CLAUDE.md`, guia de deploy e commands sem
  dependência implícita da Vercel.
- **CA-7**: `migrar-host.md` existe e lista o que é código do app.
- **CA-8**: constatação do Auth0 (§6.5) registrada no runbook de cada host.
- **CA-9**: `npm run lint`, `npm run type-check` e `npm test` verdes.
- **CA-10**: validação real ponta a ponta de Heroku e Cloud Run com o `examples/walking-skeleton`
  (um PR de teste num repositório pessoal) registrada no PR — ou, se não der para fazer antes do merge, listada como `parcial` na
  conferência spec × código.

## 10. Itens Futuros

- Skill de init (próximo brainstorming) escrevendo o `deploy.config.json`.
- Armazenamento plugável (Vercel Blob → Cloud Storage/S3) para o PerformaRM.
- Cloudflare Workers, AWS Amplify, Azure como hosts adicionais.
- Neon branch por PR (hoje todos os previews compartilham o banco de UAT).
