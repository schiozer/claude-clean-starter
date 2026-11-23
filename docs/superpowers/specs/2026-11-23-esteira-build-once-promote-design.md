# Spec: Esteira "build once, promote" com branch de integração

**Data**: 2026-11-23
**Status**: Aprovada
**Autor(es)**: Fabio Schiozer, Claudinho

> Produzida pela skill `superpowers:brainstorming`. Origem: roadmap do AssistBru.ai
> (schiozer/assistbru.ai#63, seção "Plataforma — Pipeline build once, promote").

## 1. Contexto e Objetivo

Hoje (ADR-002, ADR-005, ADR-018) o PR vira um preview, o UAT é apontado **à mão** para um preview
(bloco **UAT** do `host-<host>.md`) e o merge na `main` **recompila** para Prod. O que vai para Prod
não é o pacote testado em UAT.

Objetivo: **testar e promover o mesmo pacote**, com dois branches que representam bem o estado do
produto:

- **`develop` — branch de integração** (a trunk da integração contínua). Recebe todo o código
  pronto das feature branches, via PR. Cada merge gera **um pacote** que vai **automaticamente**
  para o UAT.
- **`main` — espelho de Prod**. Contém exatamente o commit que está em Prod. Permite corrigir um
  bug de produção **sem** passar pela integração nem fazer cherry-pick.

Duas esteiras:

- **Esteira maior** (feature, ou correção com cara de projeto):
  `feature/*` → PR → `develop` → pacote → UAT → **Promover para Prod** → mesmo pacote em Prod e a
  `main` avança (fast-forward) para o commit promovido.
- **Esteira menor** (hotfix): `hotfix/*` (a partir da `main`) → PR → `main` → pacote → Prod, sem
  UAT (testado em Dev e no preview do PR), e **back-promotion** obrigatória `main` → `develop` por
  PR aberto pelo CI.

Quem decide a esteira de uma correção é a análise do bug: se tiver cara de projeto, entra pela
`develop` e passa pelo UAT.

Chega aos projetos derivados (AssistBru.ai, ContasMes.ai, EvoluiAI, PerformaRM) via
`/template-sync` (ADR-015).

## 2. Não-Objetivos

- App iOS (`app-ios-testflight.md`): URL da API e bundle ID vão no build; UAT e Prod seguem como
  duas builds.
- "Mesmo pacote" na **Vercel**: impossível (ver §5.6, V1). Vercel tem o mesmo fluxo de branches,
  com garantia de **mesmo commit**.
- Hotfix passando por UAT: decisão explícita contra (não mesclar com o código em desenvolvimento).
- Guardar o pacote fora do host (GHCR, tarball no GitHub): descartado — o Heroku recompilaria e o
  Cloud Run não puxa do GHCR.
- Ambientes efêmeros novos: o preview por PR do ADR-018 continua como está.

## 3. Fluxo do Usuário

Atores: **humano** (dono do repo, faz merge e promoção), **agente** (Claudinho), **CI**.

### 3.1 Esteira maior

1. Agente cria `feature/*` a partir da `develop`, abre PR com base **`develop`**.
2. PR aberto/atualizado → preview do PR + `Regressão (UAT)` contra o preview (como hoje).
3. Humano mergeia o PR (squash) na `develop` (`[R3]`, como hoje na `main`).
4. CI (`deploy.yml`, push na `develop`) → `deployUat(sha)`: gera o pacote do SHA e o coloca no UAT
   fixo. Em seguida roda a `Regressão (UAT)` **contra o UAT fixo** e registra o resultado no SHA
   (commit status / GitHub Deployment `uat`).
5. Humano testa o UAT (site/celular). Vários merges podem se acumular; o UAT mostra sempre o último
   SHA da `develop` com deploy concluído.
6. Humano dispara o workflow **Promover para Prod** (`workflow_dispatch`) — `[R3]` para o agente.
7. O workflow:
   1. lê o SHA que está no UAT (o do último `deployUat` bem-sucedido);
   2. confere: Regressão contra o UAT verde para esse SHA; `main` é ancestral desse SHA
      (senão: "há back-promotion pendente — mergeie o PR `main → develop` e redeploye o UAT");
   3. `promoverProd(sha)`: leva **o mesmo pacote** para Prod (Heroku: slug; Cloud Run: digest;
      Vercel: rebuild do mesmo SHA, §5.6);
   4. smoke test em Prod; falhou → rollback automático para a release anterior e o workflow falha;
   5. **fast-forward** da `main` para o SHA com o token da **GitHub App `esteira-promover`**
      (§5.9): `git push origin <sha>:refs/heads/main`, sem `--force`; recusado se não for FF;
   6. cria a tag `vX.Y.Z` e o GitHub Release (§5.5).
8. Resultado: a `main` aponta exatamente para o commit que estava em UAT e está em Prod. Se a
   `develop` andou depois do deploy em UAT, esses commits ficam para a próxima promoção.

### 3.2 Esteira menor (hotfix)

1. Agente cria `hotfix/*` a partir da `main`, abre PR com base **`main`**. Corpo do PR marca
   "UAT não se aplica — hotfix (testado em Dev)" é tarefa do humano (`[R3]`, como hoje).
2. Preview do PR + `Regressão (UAT)` contra o preview (como hoje).
3. Humano mergeia (squash) na `main`.
4. CI (`deploy.yml`, push na `main` vindo de PR `hotfix/*`) → `deployProd(sha)`: build e deploy em
   Prod (pacote novo; hotfix não tem pacote de UAT). `release.yml` cria a tag (patch ou conforme o
   título).
5. CI abre o PR de **back-promotion** `main` → `develop` (título
   `chore(release): back-promotion de vX.Y.Z`). Humano mergeia com **merge commit** (nunca squash:
   a `main` precisa continuar ancestral da `develop`).
6. O merge da back-promotion na `develop` é um push como outro qualquer: dispara `deployUat` e a
   Regressão contra o UAT de novo (decisão do humano). Hotfix seguido de outro hotfix com o PR de
   back-promotion ainda aberto: o CI só atualiza o mesmo PR (a head é a própria `main`).
7. Conflito na back-promotion: o CI abre o PR mesmo assim e comenta; o agente resolve numa branch
   `backpromotion/*` a partir da `develop` (merge da `main` nela) e atualiza o PR.

### 3.3 Desvios

- Promover com back-promotion pendente → recusado (passo 7.2).
- Promover com Regressão do UAT vermelha ou ausente → recusado.
- Promover o mesmo SHA que já está na `main` → no-op com aviso.
- Push na `main`/`develop` fora dos caminhos permitidos → barrado (camadas 1 e 2) e alarmado
  (camada 3).
- PR com base `main` cuja head não é `hotfix/*` nem é o PR de back-promotion → `PR gate` vermelho.

## 4. Componentes

| Componente                                              | Mudança                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hooks/protect-main/config.json`                        | `protectedBranches: ["main", "develop"]`; novo bloco `esteira` (§5.1).                                                                                                                                                                                                                                                                                                                                                                     |
| `.githooks/*`, `git-guard.mjs`                          | `develop` protegida igual à `main` (só alinhar a `origin/<branch>`). Sem exceção local para a `main`: o FF da promoção é feito só pelo CI.                                                                                                                                                                                                                                                                                                 |
| `hooks/protect-main` (agente)                           | Também barra `gh workflow run`/`gh api …/dispatches` do workflow de promoção (R3) e push para `develop`.                                                                                                                                                                                                                                                                                                                                   |
| `scripts/main-guard.mjs` + `main-guard.yml`             | Vale para `main` e `develop`, com regras por branch (§5.3).                                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/pr-gate.mjs`                                   | Regras por base (§5.4).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `.github/workflows/deploy.yml`                          | Push na `develop` → `deployUat` + Regressão no UAT; push na `main` → `deployProd` **só** se o commit veio de PR `hotfix/*`.                                                                                                                                                                                                                                                                                                                |
| `.github/workflows/promover.yml` (novo)                 | `workflow_dispatch`, passos de §3.1-7.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.github/workflows/back-promotion.yml` (novo)           | Após merge de hotfix na `main`, abre/atualiza o PR `main → develop`.                                                                                                                                                                                                                                                                                                                                                                       |
| `.github/workflows/e2e-regressao.yml`                   | Também roda contra o UAT fixo após `deployUat` (alvo `uat`).                                                                                                                                                                                                                                                                                                                                                                               |
| `.github/workflows/{ci,pr-gate}.yml`                    | Disparam em PR com base `main` **e** `develop`.                                                                                                                                                                                                                                                                                                                                                                                            |
| `.github/workflows/release.yml` + `scripts/release.mjs` | Tag no merge de hotfix (como hoje) e na promoção (chamado pelo `promover.yml`), §5.5.                                                                                                                                                                                                                                                                                                                                                      |
| `scripts/deploy/index.mjs`                              | Novas operações `uat` e `promover`; `OPERACOES` cresce.                                                                                                                                                                                                                                                                                                                                                                                    |
| `scripts/deploy/hosts/*.mjs`                            | Contrato ganha `deployUat(ctx)`, `promoverProd(ctx)`, `rollbackProd(ctx)`, `urlUat(ctx)` (§5.6).                                                                                                                                                                                                                                                                                                                                           |
| `scripts/deploy/config.mjs`                             | Valida o que cada host precisar a mais (ex.: Heroku `uatApp`/`prodApp`).                                                                                                                                                                                                                                                                                                                                                                   |
| Docs                                                    | ADR novo (esteira), ADR novo (hotfix + back-promotion), ADR-002/005/014/018 com status "Substituído parcialmente por ADR-NNN" e notas; `CLAUDE.md` regras 0, 8, 9; `BEST_PRACTICES.md` (Git); `SKILLS.md`/`finishing-a-development-branch` (base do PR = `develop`); runbooks `deploy-uat.md`, `deploy-prod.md`, `rollback.md`, `host-*.md`; runbook novo `promover-prod.md` e `hotfix.md`; runbook de adoção `adotar-esteira-develop.md`. |

## 5. Regras de Negócio

### 5.1 Configuração e opt-in

- `hooks/protect-main/config.json` ganha `"esteira": { "integracao": "develop", "producao": "main", "prefixoHotfix": "hotfix/", "promotores": ["<login>"] }`.
- **Opt-in por projeto** (proposta, ver §10): sem o bloco `esteira`, tudo funciona como hoje
  (trunk na `main`). Assim o `/template-sync` não quebra um projeto que ainda não criou a `develop`;
  o runbook de adoção cria a `develop`, liga o bloco e configura o host.

### 5.2 Invariantes do git

- I1. A `main` é sempre ancestral da `develop` depois de toda back-promotion mergeada.
- I2. A `main` só muda por (a) FF do `promover.yml` para um SHA da `develop` que passou no UAT, ou
  (b) merge de PR com head `hotfix/*` (squash).
- I3. A `develop` só muda por merge de PR: features com squash; back-promotion (head `main`) com
  merge commit.
- I4. Nada reescreve histórico de `main` ou `develop` (sem force push; tags sobrevivem).
- O agente nunca escreve em nenhuma das duas (regra 0 passa a valer para ambas).

### 5.3 Guarda (camada 3) por branch

- `main`: cada commit novo em `before..after` precisa de (a) um PR mergeado com base `main` e head
  `hotfix/*`, ou (b) ser alcançável pela `develop` e `after` ter um GitHub Deployment `production`
  bem-sucedido criado pelo `promover.yml`. `forced` sempre alarma.
- `develop`: cada commit novo precisa de PR mergeado com base `develop`; merge commits só do PR de
  back-promotion.
- O FF é feito com o token da GitHub App (§5.9), então **dispara** a Guarda, o `deploy.yml` e o
  `release.yml`. A Guarda aceita o caminho (b) só se o pusher for a App (`sender` do evento =
  `esteira-promover[bot]`) **e** houver o Deployment `production` do `after` com `payload.sha`
  igual. `deploy.yml` e `release.yml` reconhecem a promoção (pusher = App) e saem sem fazer nada:
  deploy, tag e release já foram feitos pelo `promover.yml`.
- Merge commit (2 pais): permitido **só** no PR de back-promotion (head `main`, base `develop`).
  Em qualquer outro PR, o `PR gate` fica vermelho e a Guarda alarma (o repositório passa a aceitar
  merge commit por causa da back-promotion; o passo 11 do bootstrap muda para
  `allow_merge_commit=true`).

### 5.4 PR gate por base

- Base `develop`: head não pode ser `hotfix/*`; seção `## UAT` não é exigida (o UAT é após o merge).
- Base `main`: head deve ser `hotfix/*`; seção `## UAT` com "UAT não se aplica — <motivo>" (o
  humano marca; o agente nunca, R3).
- Head `main`, base `develop` (back-promotion): aceito; título `chore(release): …`.
- Qualquer outra combinação com base `main` → vermelho.
- Repositório precisa permitir **merge commit** além de squash (para a back-promotion); o gate
  avisa no PR de back-promotion que deve ser "Create a merge commit".

### 5.5 Versão (ADR-014)

- Merge na `develop`: sem tag.
- Promoção: versão = maior bump entre os títulos dos PRs entre a última tag alcançável e o SHA
  promovido (`!`/`BREAKING CHANGE` → major, `feat` → minor, resto → patch); Release lista os PRs.
- Hotfix: tag no merge, como hoje.
- Back-promotion: sem tag.

### 5.6 Contrato do adaptador (ADR-018 estendido)

Novas operações, todas recebem `ctx = { config, sha, exec, github, log, env }`:

- `deployUat(ctx)` → gera o pacote do SHA e coloca no UAT fixo; registra GitHub Deployment `uat`.
- `urlUat(ctx)` → URL do UAT fixo (alvo da Regressão no UAT).
- `promoverProd(ctx)` → leva o pacote do UAT (do SHA) para Prod; registra Deployment `production`.
- `rollbackProd(ctx)` → volta Prod para a release anterior (usado pelo smoke test falho).
- `deployProd(ctx)` existente → passa a ser só da esteira de hotfix.

Por host:

- **Heroku**: `-uat` com auto-deploy **da `develop`** (integração GitHub do Heroku) ou build pela
  Platform API — escolha do builder, desde que o SHA seja verificável (`source_blob.version`).
  `promoverProd` = `POST /pipelines/promotions` (equivalente a `pipelines:promote`) do `-uat` para o
  `-prod`, só se o slug do `-uat` for do SHA pedido. `-prod` **perde o auto-deploy da `main`**
  (senão recompila no FF). Hotfix: `deployProd` cria um build no `-prod` pela Platform API a partir
  do tarball do SHA; o workflow resolve o redirect de `GET /repos/{repo}/tarball/{sha}` com o
  `GITHUB_TOKEN` e passa ao Heroku a URL temporária resultante (o Heroku baixa sem autenticação;
  a URL nunca vai para log). Migrations: `release` phase roda também na promoção.
  Credencial: o `HEROKU_API_KEY` atual é **só leitura** (roda em código de PR) e continua assim;
  promoção/hotfix usam um segredo novo `HEROKU_DEPLOY_API_KEY` com escrita, lido **só** por
  `promover.yml` e pelo job de push na `main`/`develop` (nunca em `pull_request`).
- **Cloud Run**: `deployUat` builda a imagem do SHA, publica no Artifact Registry e faz deploy no
  serviço de UAT (100% do tráfego). `promoverProd` faz deploy no serviço de Prod **pelo digest**
  da imagem de UAT. Pré-requisito novo de bootstrap: a SA de Prod com
  `roles/artifactregistry.reader` no repositório do UAT. `deployProd` (hotfix) segue buildando.
- **Vercel (V1)**: a `develop` vira o UAT — variáveis de Preview restritas à branch `develop`
  (Hobby) ou Custom Environment `uat` (Pro); URL estável = alias da branch. `deployUat`/`urlUat`
  esperam o deploy da branch pela API de Deployments (como o preview). `promoverProd` = no-op de
  build: o FF da `main` dispara o build de Production da Vercel **do mesmo SHA**; o workflow espera
  esse deploy, faz o smoke test e, se falhar, `vercel rollback` (instantâneo). Como a `main` já
  avançou, o workflow falha, abre uma issue `esteira` ("main à frente de Prod") e a correção segue
  pela esteira de hotfix (decisão do humano). ADR registra:
  garantia de **mesmo commit**, não de mesmo pacote. Ordem dos passos 7.3–7.5 muda na Vercel (FF
  antes do deploy) — o adaptador declara isso (`promoveAposFF: true`).

### 5.7 Configuração fora do pacote

- Neon, Auth0, flags e segredos vêm do env de cada ambiente; migrations rodam no release de cada
  um.
- **Proibido** usar no build valor que muda entre UAT e Prod (ex.: `NEXT_PUBLIC_*` com domínio do
  Auth0, URL da API). O que o cliente precisar vem de runtime (ex.: rota `/api/config` ou render no
  servidor). O runbook de adoção lista as `NEXT_PUBLIC_*` do projeto e exige migrar as que diferem
  entre ambientes antes de ligar a esteira (Heroku/Cloud Run). Verificação automática: proposta de
  check que falha se o build de UAT e o de Prod teriam `NEXT_PUBLIC_*` diferentes — decisão do
  builder se cabe no escopo (marcado como minha proposta).

### 5.8 UAT fixo por host

- Heroku: o `-uat` do pipeline e a Vercel (alias/branch `develop`) já existem no bootstrap atual.
- Cloud Run: se o serviço de UAT fixo não existir, o runbook de adoção o cria.

### 5.9 GitHub App `esteira-promover`

- Criada pelo humano (R3) uma vez, instalada nos repositórios que adotam a esteira, com permissão
  `contents: write` e `deployments: write`. ID e chave privada em segredos (`ESTEIRA_APP_ID`,
  `ESTEIRA_APP_PRIVATE_KEY`) disponíveis **só** para o `promover.yml` (Environment `production`).
- Com branch protection no GitHub, a App fica na lista de bypass da `main`; sem ela, nada muda.
- O token é gerado a cada execução (`actions/create-github-app-token`), vale 1 h e nunca vai para
  log.
- Runbook novo `esteira-github-app.md` (criar, instalar, gravar segredos, rotacionar a chave).

### 5.10 Classes de risco (ADR-013)

- Disparar `promover.yml` → **R3** para o agente (só o humano).
- Mergear PR em `develop` ou `main`, incluindo back-promotion → **R3** (como hoje).
- `deployUat` automático → R1 (CI).
- Rollback manual de Prod → R2 (como hoje).

## 6. Dados / Queries

Sem banco. Estado vive em:

- GitHub Deployments (`uat`, `production`) por SHA, com `payload` do host (slug, digest, deploy id).
- Commit status/check da Regressão no UAT por SHA.
- Tags `vX.Y.Z`.

## 7. Requisitos não funcionais

Segue o baseline. Específicos de CI (não de app):

- Promoção (Heroku/Cloud Run) sem rebuild: termina em < 5 min fora do smoke test.
- Todo script novo é Node testável no Vitest com `fetch`/`exec` injetados (padrão de `scripts/`).
- Nenhum token entra em log ou mensagem de erro.

## 8. Cenários de teste

Não há tela: os cenários viram testes **Vitest** em `tests/` da raiz (padrão de `scripts/`), não
Playwright. Lista mínima:

- CT-ESTEIRA-001 — git-guard recusa commit/push local em `develop` e aceita alinhar a `origin/develop`.
- CT-ESTEIRA-002 — protect-main barra `gh workflow run promover.yml` e push para `develop`.
- CT-ESTEIRA-003 — pr-gate: base `develop` + head `feature/x` ok; base `main` + head `feature/x` vermelho; base `main` + head `hotfix/x` ok com "UAT não se aplica"; head `main` → base `develop` ok.
- CT-ESTEIRA-004 — main-guard: push na `main` com commits da `develop` e Deployment `production` do `promover` ok; commit sem PR nem deployment alarma; `forced` alarma.
- CT-ESTEIRA-005 — main-guard: merge commit na `develop` fora da back-promotion alarma.
- CT-ESTEIRA-006 — promover: recusa se `main` não é ancestral do SHA do UAT (back-promotion pendente).
- CT-ESTEIRA-007 — promover: recusa sem Regressão do UAT verde para o SHA.
- CT-ESTEIRA-008 — promover: smoke falho → `rollbackProd` chamado e `main` **não** avança.
- CT-ESTEIRA-009 — release: bump da promoção = maior bump dos PRs entre a última tag e o SHA.
- CT-ESTEIRA-010 — Heroku `promoverProd` recusa se o slug do `-uat` não é do SHA pedido.
- CT-ESTEIRA-011 — Cloud Run `promoverProd` usa o digest do deploy de UAT do SHA.
- CT-ESTEIRA-012 — Vercel `promoverProd` espera o deploy de Production do SHA e faz rollback no smoke falho.
- CT-ESTEIRA-013 — back-promotion: após merge de `hotfix/*` na `main`, abre PR `main → develop` (idempotente se já existe).
- CT-ESTEIRA-014 — sem bloco `esteira` no config, todos os comportamentos acima ficam como hoje.

## 9. Critérios de Aceitação

- CA-1. Merge na `develop` coloca o SHA no UAT sem ação manual, e a Regressão roda contra o UAT.
- CA-2. "Promover para Prod" leva para Prod o mesmo slug (Heroku) / digest (Cloud Run) do UAT e
  avança a `main` por fast-forward para esse SHA; na Vercel, o mesmo SHA.
- CA-3. Hotfix mergeado na `main` vai para Prod e abre o PR de back-promotion automaticamente.
- CA-4. Nenhuma das três camadas permite escrever em `main`/`develop` fora de I2/I3.
- CA-5. Projeto sem bloco `esteira` não muda de comportamento.
- CA-6. Docs (ADRs, CLAUDE.md, runbooks) descrevem as duas esteiras e a adoção.

## 10. Decisões registradas

- Opt-in por bloco `esteira` (§5.1): aprovado pelo humano.
- O repositório do template **não** adota a `develop` agora (não tem host para promover); só
  distribui a esteira. Aprovado pelo humano.
- Credencial do FF: GitHub App (§5.9), escolhida pelo humano entre App e `GITHUB_TOKEN`.
- Back-promotion redeploya o UAT; hotfixes seguidos atualizam o mesmo PR (§3.2): aprovado.
- Smoke falho na Vercel → issue + esteira de hotfix (§5.6): aprovado.
- Merge commit só na back-promotion (§5.3): aprovado.
- Proteção do `promover.yml` (call do Claudinho): `workflow_dispatch` + hook do agente + o job
  recusa se `github.actor` não estiver em `esteira.promotores` do config. Em repositório privado no
  plano gratuito não há _required reviewers_; isso é verificação, não barreira — risco aceito.
- O parser do `hooks/protect-main` precisa cobrir as formas `gh workflow run` e
  `gh api … /dispatches` (call do builder).

## Abordagens consideradas

- **Trunk na `main`, merge → UAT, "promover" → mesmo pacote em Prod**: uma branch só. Descartada
  pelo humano: quer a `main` como espelho de Prod para hotfix sem cherry-pick.
- **`develop` → `main` por PR**: descartada — a `main` deve ser idêntica à `develop` promovida; o FF
  pelo workflow faz isso sem PR e sem divergência.
- **`develop` → `main` por force push**: descartada a favor do fast-forward, que tem o mesmo
  resultado sem apagar tags nem commits de hotfix.
- **Hotfix passando por UAT**: descartada — o UAT não mistura hotfix com o que está em integração.
- **Promoção só no Heroku** (opção B): descartada — Cloud Run consegue a garantia pelo digest.
- **Vercel V2 (deploy de Prod em espera)**: descartada — o UAT rodaria com a configuração de Prod.
- **Só `GITHUB_TOKEN` no FF**: descartada — não passa por branch protection e o push não dispara a
  Guarda, que perderia a promoção de vista.
- **Escolhida**: esteira com `develop` + FF pela GitHub App, promoção no contrato do adaptador (A),
  Vercel V1.
