# Esteira "build once, promote" — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Duas esteiras no template — `feature/* → develop → UAT → Promover → main/Prod` com o
mesmo pacote, e `hotfix/* → main → Prod` com back-promotion — opt-in pelo bloco `esteira`.

**Architecture:** Um módulo novo `scripts/esteira/` concentra a leitura do bloco `esteira` e as
regras puras (classificação de PR, ancestralidade, bump). As três camadas de proteção, o PR gate,
o release e a camada de deploy consomem esse módulo. Dois workflows novos (`promover.yml`,
`back-promotion.yml`) chamam CLIs Node testáveis. Sem bloco `esteira`, todo comportamento é o atual.

**Tech Stack:** Node 20 ESM (`.mjs`, sem dependências novas, validação à mão — ADR-007), Vitest,
GitHub Actions, `actions/create-github-app-token@v2`, Heroku Platform API, `gcloud`, Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-11-23-esteira-build-once-promote-design.md`

## Global Constraints

- Opt-in: sem `esteira` em `hooks/protect-main/config.json`, nenhum comportamento muda (CA-5,
  CT-ESTEIRA-014). Todo teste novo de comportamento tem o par "sem esteira → como hoje".
- Bloco: `"esteira": { "integracao": "develop", "producao": "main", "prefixoHotfix": "hotfix/", "promotores": ["<login>"] }`.
  O **template não liga** o bloco no próprio `config.json` (spec §10).
- Nunca `--force`; FF da `main` só pelo `promover.yml` com o token da App `esteira-promover`.
- Pusher da App: `esteira-promover[bot]`. Segredos: `ESTEIRA_APP_ID`, `ESTEIRA_APP_PRIVATE_KEY`
  (Environment `production`); `HEROKU_DEPLOY_API_KEY` (escrita, nunca em `pull_request`);
  `HEROKU_API_KEY` continua só leitura.
- GitHub Deployments: ambientes `uat` e `production`, `payload.sha` = SHA, `payload` do host
  (`slug` | `digest` | `deploymentId`).
- Título do PR de back-promotion: `chore(release): back-promotion de vX.Y.Z`; branch head = `main`.
- Merge commit só no PR head `main` → base `develop`.
- Tokens nunca em log nem em mensagem de erro (incluindo a URL temporária do tarball).
- Mensagens em pt-BR; commits `tipo(escopo): mensagem` ≤ 72 chars, com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Todo script novo: funções puras + `executar(...)` com `fetchFn`/`exec`/`github` injetáveis + bloco
  `isMain` (padrão de `scripts/deploy/index.mjs`).
- Testes de workflow seguem `tests/unit/deployWorkflow.test.ts` (asserções sobre o YAML lido).
- Todo teste novo entra em `template-sync.manifest.json` (`managed`), como os existentes.

## Review Focus

1. **Projeto derivado sem `develop` recebe o sync** — tudo segue como hoje; nenhum workflow passa
   a disparar em `develop` nem falha. Teste: Task 1 (`lerEsteira` sem bloco → `null`) e asserção
   em cada teste de workflow de que o caminho novo é condicionado a `esteira`.
2. **Promover duas vezes o mesmo SHA / dois promover concorrentes** — o segundo é no-op com aviso,
   sem tag duplicada. Teste na Task 8 (`main` já no SHA → `{ promovido: false }`) e
   `concurrency: promover` sem cancelamento no YAML.
3. **Deployment `uat` mais recente é de um SHA que falhou** — promover usa o último `uat` com
   status `success`, nunca o mais novo com `failure`. Teste na Task 8.
4. **PR de back-promotion mergeado por squash por engano** — a Guarda da `develop` alarma
   (a `main` deixa de ser ancestral) e o próximo promover recusa com a mensagem de back-promotion.
   Teste na Task 4 (commit sem 2 pais vindo de PR head `main`) e Task 8.
5. **Hotfix mergeado enquanto a promoção roda** — Prod já recebeu o pacote, mas a `main` andou e o
   FF deixaria de ser FF. O `promover` checa a ancestralidade de novo logo antes do FF; se falhar,
   faz `rollbackProd` e falha com `a main mudou durante a promoção (hotfix?)`. Teste na Task 8.

---

### Task 1: Módulo `scripts/esteira/` (config + regras puras)

**Files:**

- Create: `scripts/esteira/config.mjs`, `scripts/esteira/regras.mjs`
- Test: `tests/unit/esteiraConfig.test.ts`, `tests/unit/esteiraRegras.test.ts`

**Interfaces:**

- Produces:
  - `lerEsteira(raiz?: string): Esteira | null` e `parseEsteira(json: unknown): Esteira | null`
    — `Esteira = { integracao: string, producao: string, prefixoHotfix: string, promotores: string[] }`.
    Ausente → `null`; presente e inválido → `Error` com prefixo `esteira:` nomeando o campo.
  - `classificarPr({ base, head }, esteira): 'feature' | 'hotfix' | 'back-promotion' | 'invalido'`
    — base integracao + head ≠ hotfix → feature; base integracao + head producao → back-promotion;
    base producao + head com prefixoHotfix → hotfix; resto → invalido.
  - `PUSHER_APP = 'esteira-promover[bot]'`
  - `maiorBump(titulos: string[], corpos: string[]): 'major' | 'minor' | 'patch'` — reusa
    `bumpType` de `scripts/release.mjs`.

- [ ] **Step 1: Testes** — `parseEsteira(undefined)` → `null`; bloco válido → objeto; `promotores`
      vazio ou não-array → erro `esteira: promotores deve ser uma lista não vazia de logins`;
      `integracao === producao` → erro. `classificarPr` para as 5 combinações da spec §5.4.
      `maiorBump(['fix: a','feat: b'],['',''])` → `minor`; com `feat!: c` → `major`.
- [ ] **Step 2:** `npx vitest run tests/unit/esteira` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar; `lerEsteira` lê `hooks/protect-main/config.json` da raiz.
- [ ] **Step 4:** `npx vitest run tests/unit/esteira` → PASS.
- [ ] **Step 5:** Adicionar os 2 testes ao manifesto; commit `feat(esteira): config e regras puras da esteira`.

### Task 2: Camada 1 — git hooks protegem a `develop`

**Files:**

- Modify: `hooks/protect-main/git-guard.mjs:105-135` (`readProtectedBranches` local)
- Test: `tests/unit/gitGuard.test.ts`

**Interfaces:**

- Consumes: `lerEsteira`.
- Produces: `branchesProtegidas(config): string[]` exportada de `git-guard.mjs` = `protectedBranches`
  ∪ `[esteira.integracao]` quando há esteira (sem duplicar).

- [ ] **Step 1: Testes** — `branchesProtegidas({ protectedBranches: ['main'] })` → `['main']`;
      com esteira → `['main','develop']`; `checkPrePush` com destino `refs/heads/develop` e esteira →
      recusa; `checkRefTransaction` alinhando `develop` a `origin/develop` → permite.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** `npx vitest run tests/unit/gitGuard` → PASS.
- [ ] **Step 5:** O shim `.githooks/*` pré-filtra só por `protectedBranches`: adicionar ao `sed`
      a extração de `"integracao"` (mesmo estilo POSIX) e um caso em `tests/unit/gitGuardHooks.test.ts`
      (commit local em `develop` com esteira → recusado). Rodar → PASS. Commit `feat(protect-main): git hooks protegem a branch de integração`.

### Task 3: Camada 2 — hook do agente

**Files:**

- Modify: `hooks/protect-main/evaluate.mjs` (B8–B9, ~linhas 248-310) e o carregamento do contexto em `hooks/protect-main/run.mjs`
- Test: `tests/unit/protectMainEvaluate.test.ts`

**Interfaces:**

- Consumes: `branchesProtegidas` (Task 2).
- Produces: `EvalContext.protectedBranches` passa a incluir a integração.

- [ ] **Step 1: Testes** — com esteira: `git push origin develop`, `git commit` na `develop` →
      bloqueados. Sempre (com ou sem esteira): `gh workflow run promover.yml`,
      `gh workflow run "Promover para Prod"`, `gh api -X POST repos/o/r/actions/workflows/promover.yml/dispatches`,
      `gh api repos/o/r/dispatches -f event_type=x` → bloqueados com motivo
      `` `Promover para Prod` é disparado pelo humano (`[R3]`). ``. `gh workflow list` → permitido.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (`gh workflow run|enable|disable` de `promover`
      e todo `…/dispatches` POST). **Step 4:** `npx vitest run tests/unit/protectMain` → PASS.
- [ ] **Step 5:** Commit `feat(protect-main): agente não dispara a promoção nem escreve na develop`.

### Task 4: Camada 3 — Guarda por branch

**Files:**

- Modify: `scripts/main-guard.mjs` (`runMainGuard`, `findUnmerged`, `evaluateGates`, `makeGithubApi`), `.github/workflows/main-guard.yml`
- Test: `tests/unit/mainGuard.test.ts`

**Interfaces:**

- Consumes: `lerEsteira`, `classificarPr`, `PUSHER_APP`, `branchesProtegidas`.
- Produces: `GuardApi` ganha `deployments(sha: string, environment: string): Promise<{ id, payload, creator: { login } }[]>`
  e `deploymentOk(id: number): Promise<boolean>`; `event.sender.login` passa a ser lido.

Regras (spec §5.3): com esteira, push na `producao` com `sender.login === PUSHER_APP` é legítimo
se existir Deployment `production` do `after` com `payload.sha === after`, status `success`, e
`commits` ⊂ commits alcançáveis da integração (via `compare(after, integracao)` com `ahead_by >= 0`
e `behind_by === 0`). Sem isso → alarme. PRs para `producao` com classificação ≠ `hotfix` → alarme
de gates. Push na `integracao`: commit com 2 pais só se o PR é `back-promotion`; nesse caso
`evaluateGates` não reclama do merge commit.

- [ ] **Step 1: Testes** — CT-ESTEIRA-004 (FF da App com deployment ok → `ok: true`; mesmo push com
      `sender` humano → alarme; deployment com `payload.sha` diferente → alarme; `forced` → alarme),
      CT-ESTEIRA-005 (merge commit na `develop` de PR `feature` → alarme; de `back-promotion` → ok),
      PR `feature/x` mergeado na `main` com esteira → gate failure `base main exige hotfix/*`,
      e o caso sem esteira (suite atual intacta).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `npx vitest run tests/unit/mainGuard` → PASS.
- [ ] **Step 5:** `main-guard.yml`: `on.push.branches: [main, develop]`, `permissions.deployments: read`.
      Teste de YAML novo em `tests/unit/mainGuard.test.ts`. Commit `feat(main-guard): guarda por branch na esteira`.

### Task 5: PR gate por base

**Files:**

- Modify: `scripts/pr-gate.mjs` (`checkPr` e entrypoint), `.github/workflows/pr-gate.yml`, `.github/workflows/ci.yml`
- Test: `tests/unit/prGate.test.ts`

**Interfaces:**

- Consumes: `classificarPr`, `lerEsteira`.
- Produces: `checkPr({ title, body, action, fileExists, base?, head?, esteira? })` — `base/head/esteira`
  opcionais; ausentes = comportamento atual.

Regras (spec §5.4): `feature` → sem checagem de `## UAT`; `hotfix` → `## UAT` exigida e, se
marcada, tem de ser "não se aplica — <motivo>" (marcar "UAT aprovado" é erro:
`hotfix não passa pelo UAT: use "UAT não se aplica — <motivo>"`); `back-promotion` → título deve
casar `^chore\(release\): back-promotion de v\d+\.\d+\.\d+$`, spec dispensada, e um aviso
(não erro) `mergeie com "Create a merge commit", nunca squash`; `invalido` → erro
`base <base> só aceita <regra>`.

- [ ] **Step 1: Testes** — CT-ESTEIRA-003 completo + os 3 casos acima + `esteira` ausente → igual a hoje.
- [ ] **Step 2:** FAIL. **Step 3:** implementar; o entrypoint lê `pull_request.base.ref`/`head.ref`.
      `checkPr` continua devolvendo `string[]` de erros; o aviso sai por `process.stdout` no entrypoint
      via a nova `avisosDoPr({ base, head, esteira }): string[]`.
- [ ] **Step 4:** PASS. **Step 5:** `pr-gate.yml` e `ci.yml`: `branches: [main, develop]`; teste de
      YAML. Commit `feat(pr-gate): regras por base para a esteira`.

### Task 6: Contrato do adaptador — Heroku

**Files:**

- Modify: `scripts/deploy/hosts/heroku.mjs`, `scripts/deploy/config.mjs` (heroku: `uatApp`, `prodApp` obrigatórios **só** com esteira — `parseDeployConfig(texto, { esteira })`)
- Create: `scripts/deploy/githubDeployments.mjs`
- Test: `tests/unit/deployHeroku.test.ts`, `tests/unit/deployConfig.test.ts`, `tests/unit/deployGithubDeployments.test.ts`

**Interfaces:**

- Produces (contrato, vale para Tasks 7 e 8):
  - `deployUat(ctx): Promise<{ url: string, payload: object }>`
  - `urlUat(ctx): Promise<string>`
  - `promoverProd(ctx): Promise<{ payload: object }>`
  - `rollbackProd(ctx): Promise<void>`
  - `promoveAposFF: boolean` (só Vercel `true`)
  - `ctx = { config, sha, exec, github, log, env, fetchFn }`
- `githubDeployments.mjs`: `registrar(github, { sha, ambiente: 'uat'|'production', url, payload }): Promise<number>`,
  `ultimoOk(github, ambiente): Promise<{ sha, payload, url } | null>` (mais novo com status
  `success`, ignorando `failure`/`error`), `marcar(github, id, state, url?)`.

Heroku (spec §5.6): `deployUat` cria build no `uatApp` via `POST /apps/{uatApp}/builds` com
`source_blob: { url: <tarball>, version: sha }` e espera `succeeded` (reusa o polling de
`aguardarReviewApp`, extraído para `esperarBuild`); payload `{ slug }`. `promoverProd` lê a release
atual do `uatApp`, exige `slug` do build com `source_blob.version === sha` (senão erro
`slug do UAT não é de <sha7>` — CT-ESTEIRA-010), `POST /pipeline-promotions` para `prodApp`,
espera `succeeded`. `rollbackProd` = `POST /apps/{prodApp}/releases` com `{ slug: <anterior> }`.
`deployProd` (hotfix) = build no `prodApp` do tarball. Token: `env.HEROKU_DEPLOY_API_KEY`
(erro claro se faltar). URL do tarball: `tarballUrl(github, sha)` faz `GET /tarball/{sha}` com
`redirect: 'manual'` e devolve o `Location`; nunca logado.

- [ ] **Step 1: Testes** — fetch injetado: CT-ESTEIRA-010; build `failed` → erro; `promoverProd`
      com slug certo chama `/pipeline-promotions` com `source.app.id = uatApp` e `targets[0].app.id = prodApp`;
      `rollbackProd`; `tarballUrl` não aparece em nenhum `log` (spy). `ultimoOk` pula `failure`.
      `parseDeployConfig` com esteira e sem `uatApp` → erro; sem esteira → ok.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `npx vitest run tests/unit/deploy` → PASS.
- [ ] **Step 5:** Commit `feat(deploy): heroku promove o slug do uat para prod`.

### Task 7: Contrato do adaptador — Cloud Run e Vercel

**Files:**

- Modify: `scripts/deploy/hosts/cloudrun.mjs`, `scripts/deploy/hosts/vercel.mjs`
- Test: `tests/unit/deployCloudRun.test.ts`, `tests/unit/deployVercel.test.ts` (novo)

**Interfaces:**

- Consumes: contrato e `githubDeployments` (Task 6).

Cloud Run: `deployUat` builda `imagem(cfg,'uat',`develop-${sha7}`)`, push, `gcloud run deploy`
no serviço de UAT com 100% do tráfego, lê o digest (`gcloud artifacts docker images describe … --format=value(image_summary.digest)`);
payload `{ digest, imagem }`. `promoverProd(ctx)` usa o `payload.digest` do `ultimoOk(github,'uat')`
cujo `sha === ctx.sha` e faz `gcloud run deploy <prod.service> --image <repo-uat>@<digest>` +
`update-traffic --to-latest` (CT-ESTEIRA-011; sem build). `rollbackProd` = `update-traffic
--to-revisions=<anterior>=100` (revisão anotada antes do deploy).
Vercel: `deployUat` = `waitPreview` com `ambienteDePreview` aceitando o ambiente da branch de
integração (`Preview` com `ref` = integração, ou `uat` custom) e o `sha`; `urlUat` = alias de
`config.vercel.uatAlias`. `promoveAposFF = true`; `promoverProd` espera o Deployment
`Production` do SHA pela API do GitHub; `rollbackProd` = `exec('vercel', ['rollback', '--yes', '--scope', team])`
com `VERCEL_TOKEN` (CT-ESTEIRA-012).

- [ ] **Step 1: Testes** — CT-ESTEIRA-011 (comando `gcloud run deploy` com `@sha256:` e sem `docker build`);
      `promoverProd` sem deployment `uat` do SHA → erro `sem deploy de UAT para <sha7>`; CT-ESTEIRA-012.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5:** commit
      `feat(deploy): cloud run promove por digest e vercel pelo mesmo sha`.

### Task 8: CLI de promoção + `promover.yml`

**Files:**

- Create: `scripts/esteira/promover.mjs`, `.github/workflows/promover.yml`
- Modify: `scripts/deploy/index.mjs` (`OPERACOES` += `'uat'`, `'promover'`; `'uat'` chama `deployUat` + `registrar`)
- Test: `tests/unit/esteiraPromover.test.ts`, `tests/unit/esteiraWorkflows.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 6, 7; `runRelease` estendido (Task 9: `runReleasePromocao`).
- Produces: `promover({ esteira, adapter, github, git, smoke, actor, log }): Promise<{ promovido: boolean, sha?: string, tag?: string }>`
  — `git = { ehAncestral(a,b): Promise<boolean>, shaDe(branch): Promise<string>, ff(sha): Promise<void> }`,
  `smoke(url): Promise<boolean>`.

Ordem (spec §3.1-7, Heroku/Cloud Run): actor ∈ promotores → `ultimoOk('uat')` → check
`Regressão (UAT)` do SHA verde → `main` já é o SHA? no-op → `ehAncestral(main, sha)` senão erro
`há back-promotion pendente: mergeie o PR main → develop e aguarde o novo deploy de UAT`
(CT-006) → `promoverProd` → `registrar('production')` → `smoke` falho → `rollbackProd`, marcar
`failure`, erro, **sem FF** (CT-008) → `ehAncestral` de novo, falho → rollback + erro → `ff(sha)` →
release. Vercel (`promoveAposFF`): checagens → `ff` → `promoverProd` (espera) → smoke falho →
`rollbackProd` + issue `esteira` "main à frente de Prod" + erro.

`promover.yml`: `workflow_dispatch` sem inputs; `concurrency: { group: promover, cancel-in-progress: false }`;
`environment: production`; passos: `actions/create-github-app-token@v2` (`app-id: ${{ secrets.ESTEIRA_APP_ID }}`,
`private-key: ${{ secrets.ESTEIRA_APP_PRIVATE_KEY }}`), checkout com `fetch-depth: 0` e o token da
App, setup-node 20, credenciais do host (blocos do `deploy.yml`), `node scripts/esteira/promover.mjs`.
Sai cedo com aviso se não há esteira.

- [ ] **Step 1: Testes** — CT-ESTEIRA-006, 007, 008; Review Focus 2, 3, 5; actor fora de
      `promotores` → erro sem chamar o adapter; Vercel ordem FF→deploy e issue no smoke falho.
      YAML: `workflow_dispatch`, `concurrency` sem cancelar, `create-github-app-token`, sem `--force`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(esteira): workflow promover para prod`.

### Task 9: Release na promoção

**Files:**

- Modify: `scripts/release.mjs`, `.github/workflows/release.yml`
- Test: `tests/unit/release.test.ts`

**Interfaces:**

- Produces: `runReleasePromocao({ de, ate }, api, opts): Promise<{ created: boolean, tag: string }>`
  — PRs = `pullsForCommit` de cada commit de `compare(de, ate)` com base integração, deduplicados;
  bump = `maiorBump`; notas listam `#n título`. `de` = última tag alcançável pela `main`.

- [ ] **Step 1: Testes** — CT-ESTEIRA-009; back-promotion entre os PRs é ignorado no bump;
      `release.yml`: job pula quando `github.event.sender.login == 'esteira-promover[bot]'` (já
      liberado pelo promover) — asserção no YAML.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** commit `feat(release): versão da promoção pelo maior bump`.

### Task 10: `deploy.yml`, Regressão no UAT e back-promotion

**Files:**

- Modify: `.github/workflows/deploy.yml`, `.github/workflows/e2e-regressao.yml`
- Create: `scripts/esteira/backPromotion.mjs`, `.github/workflows/back-promotion.yml`
- Test: `tests/unit/deployWorkflow.test.ts`, `tests/unit/esteiraBackPromotion.test.ts`, `tests/unit/esteiraWorkflows.test.ts`

**Interfaces:**

- Consumes: `classificarPr`, `PUSHER_APP`, operação `uat` (Task 8).
- Produces: `abrirBackPromotion({ github, esteira, tag }): Promise<{ numero: number, criado: boolean }>`
  — PR aberto head `producao`/base `integracao` já existe → atualiza título e comenta; senão cria.
  Corpo segue `.github/pull_request_template.md` com `Spec: n/a — back-promotion` e a nota de merge commit.
  Conflito (`mergeable === false` após criar) → comentário pedindo resolução em `backpromotion/*`.

`deploy.yml`: novo job/step "Esteira" que lê `node scripts/esteira/index.mjs ativa` (output
`ativa=true|false`, `integracao`). `on.push.branches: [main, develop]`. Push na integração com
esteira → `deploy uat`. Push na `main` com esteira: `sender == PUSHER_APP` → no-op; senão →
`deploy prod` (hotfix). Sem esteira → como hoje. `HEROKU_DEPLOY_API_KEY` só em `push`.
`e2e-regressao.yml`: `pull_request.branches: [main, develop]` + `workflow_run` do `Deploy` em
`develop` (alvo = `urlUat`), publicando um check `Regressão (UAT)` no SHA.
`back-promotion.yml`: `on.push.branches: [main]`, roda só com esteira e `sender != PUSHER_APP`,
chama `backPromotion.mjs`.

- [ ] **Step 1: Testes** — CT-ESTEIRA-013 (cria; já existe → atualiza; idempotente); conflito →
      comenta; YAML: `HEROKU_DEPLOY_API_KEY` ausente de qualquer step de `pull_request`; condicionais
      de esteira; sem esteira = caminho antigo.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** commit `feat(esteira): deploy de uat, regressão no uat e back-promotion`.

### Task 11: Documentação — ADRs, regras e runbooks

**Files:**

- Create: `docs/adr/template/020-esteira-integracao-e-promocao.md`, `docs/adr/template/021-hotfix-e-back-promotion.md`,
  `docs/runbooks/promover-prod.md`, `docs/runbooks/hotfix.md`, `docs/runbooks/esteira-github-app.md`,
  `docs/runbooks/adotar-esteira-develop.md`
- Modify: ADR-002/005/014/018 (status "Substituído parcialmente por ADR-020" + nota), `CLAUDE.md`
  (regras 0, 8, 9: "`main` e `develop` só recebem via PR, salvo o FF da promoção feito pela App"),
  `BEST_PRACTICES.md` (Git), `SKILLS.md` (finishing: base do PR = `develop` com esteira; hotfix = `main`),
  `docs/runbooks/{deploy-uat,deploy-prod,rollback,bootstrap-ambientes,host-heroku,host-cloudrun,host-vercel}.md`,
  `docs/runbooks/README.md` (catálogo), `template-sync.manifest.json`
- Test: `npm run check:runbooks`, `tests/unit/docsLinks.test.ts`

Conteúdo mínimo: ADR-020 com as decisões e alternativas da spec; ADR-021 com as duas esteiras e
o critério "cara de projeto → develop". `adotar-esteira-develop.md`: criar `develop` a partir da
`main` (R3, humano), ligar o bloco `esteira` por PR, inventário de `NEXT_PUBLIC_*` (§5.7), host
(Heroku: tirar auto-deploy do `-prod`, gravar `HEROKU_DEPLOY_API_KEY`, `uatApp`/`prodApp`;
Cloud Run: serviço de UAT se faltar + `artifactregistry.reader` para a SA de Prod; Vercel: env de
Preview restrita à `develop` ou Custom Environment), App, `allow_merge_commit=true`, bypass da App
na branch protection. Riscos R0–R3 em todo passo.

- [ ] **Step 1:** Escrever os docs. **Step 2:** `npm run check:runbooks` e `npx vitest run tests/unit/docsLinks` → PASS.
- [ ] **Step 3:** `npx prettier --check .` → ok. **Step 4:** commit `docs(esteira): adrs 020-021, regras e runbooks da esteira`.

### Task 12: Verificação final

- [ ] `npm run lint`, `npm run type-check`, `npm test` → tudo verde.
- [ ] Conferência spec × código (tabela do template de PR) cobrindo CA-1…CA-6 e CT-ESTEIRA-001…014.
- [ ] PR com base `main` (o template não adota a esteira), UAT desmarcado.
