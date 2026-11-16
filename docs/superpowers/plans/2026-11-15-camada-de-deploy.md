# Camada de deploy (Vercel, Heroku, Cloud Run) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o template passa a aceitar Vercel, Heroku e Cloud Run como host, escolhido em
`deploy.config.json`, sem mudar o fluxo PR → preview + `Regressão (UAT)` → merge → Prod.

**Architecture:** adaptadores em `scripts/deploy/hosts/<host>.mjs` com um contrato único
(`deployPreview`, `deployProd`, `encerrarPreview`, `ambienteDePreview`), escolhidos por
`scripts/deploy/config.mjs`. A espera do preview usa um só mecanismo (GitHub Deployments). Um
workflow novo `deploy.yml` chama a CLI `scripts/deploy/index.mjs`. Os comandos de host saem dos
runbooks gerais e vão para `docs/runbooks/host-<host>.md`.

**Tech Stack:** Node 20 ESM (`.mjs`, sem dependências novas — ADR-007), Vitest, GitHub Actions,
`gcloud`/`docker` (Cloud Run), Platform API do Heroku (condicional), Playwright (suporte E2E em TS).

**Spec:** `docs/superpowers/specs/2026-11-13-camada-de-deploy-design.md`

## Global Constraints

- Hosts válidos: exatamente `vercel`, `heroku`, `cloudrun`. `deploy.config.json` ausente ≡ `{ "host": "vercel" }`.
- Sem feature toggle; sem dependência npm nova na raiz (o tooling da raiz não tem Zod — ADR-007).
- Segredos nunca em `deploy.config.json`, nunca ecoados em log, nunca passados em argumento de CLI (ADR-013 §4).
- Timeout de espera do preview: 15 min (`DEFAULT_TIMEOUT_MS = 900_000`), intervalo 15 s — não mudam.
- Cloud Run: `min-instances=0`; imagem construída no GitHub Actions (não Cloud Build); preview = tag `pr-<n>` com `--no-traffic`; auth por Workload Identity Federation; o CI não configura env do app.
- Limpeza do Artifact Registry: manter as 5 imagens mais novas; apagar tags `pr-*` com mais de 7 dias.
- PR de fork não roda deploy.
- `deploy.yml` **não** entra em `requiredChecks` de `hooks/protect-main/config.json`.
- `wait-preview.mjs` continua existindo como fachada por uma Release.
- Código e docs em português; nomes de código seguem o estilo dos scripts atuais (camelCase em português, ex.: `waitPreview`, `consultar`).
- Todo teste novo em `tests/unit/` entra no `managed` de `template-sync.manifest.json`.

## Review Focus

1. **`deploy.config.json` com JSON quebrado ou campo vazio** → erro citando o arquivo e o campo, nunca stack trace de `JSON.parse` (Task 1).
2. **Host `vercel`/`heroku` no `deploy.yml`** → termina sem chamar `gcloud`/`docker` e sem exigir credencial GCP (Tasks 3 e 7).
3. **Push novo no mesmo PR (Cloud Run)** → a tag `pr-<n>` passa para a revisão nova e o Deployment publicado aponta para o SHA novo; o `aguardarPreview` do SHA antigo não serve a URL nova (Task 4).
4. **Serviço Cloud Run ainda não criado** → `deployPreview` falha com "rode o Bootstrap de host-cloudrun.md", não com o erro cru do `gcloud` (Task 4).
5. **PR e merge concorrentes** → o `deploy.yml` serializa por PR (`deploy-pr-<n>`) e por Prod (`deploy-prod`) sem cancelar o deploy de Prod em andamento (Task 7).

---

### Task 0: Constatações que decidem as tarefas condicionais

Sem código. Resultado registrado na seção "Constatações" no fim deste plano (commit junto).

- [ ] **Step 1: Heroku publica GitHub Deployment do review app?** Na documentação do Heroku (Review Apps / GitHub integration) e, se o humano tiver um pipeline de teste, num PR real (`gh api repos/<r>/deployments?sha=<sha>`), anotar: publica ou não, o nome do `environment` e onde vem a URL (`environment_url`/`target_url`).
  Resultado: **sim** → Task 5 é pulada e `ambienteDePreview` do Heroku usa o nome constatado. **Não** → Task 5 entra.
- [ ] **Step 2: Auth0 aceita curinga nas Allowed Callback/Logout URLs** para `https://*.herokuapp.com` e `https://pr-*---<serviço>-<hash>.<região>.run.app`? Consultar a documentação de "Subdomain URL placeholders" do Auth0.
  Resultado: **sim** → Task 12 é pulada e o padrão vai para os runbooks de host. **Não** → Task 12 entra.
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-11-15-camada-de-deploy.md
git commit -m "docs(plan): constatações heroku e auth0 da camada de deploy"
```

---

### Task 1: `deploy.config.json` — leitura e validação

**Files:**
- Create: `scripts/deploy/config.mjs`
- Test: `tests/unit/deployConfig.test.ts`

**Interfaces:**
- Produces: `HOSTS = ['vercel', 'heroku', 'cloudrun']`; `CONFIG_PATH = 'deploy.config.json'`;
  `parseDeployConfig(texto: string | null): DeployConfig` (texto `null` = arquivo ausente);
  `lerDeployConfig(raiz = process.cwd()): DeployConfig`.
  `DeployConfig = { host: 'vercel' | 'heroku' | 'cloudrun', cloudrun?: CloudRunConfig }`;
  `CloudRunConfig = { region, repository, uat: Ambiente, prod: Ambiente }`;
  `Ambiente = { project, service, wifProvider, serviceAccount }` (todas strings não vazias).

- [ ] **Step 1: Testes que falham**

```ts
it('ausente → vercel', () => expect(parseDeployConfig(null)).toEqual({ host: 'vercel' }))
it('host desconhecido → erro com os válidos', () =>
  expect(() => parseDeployConfig('{"host":"netlify"}')).toThrow(/host 'netlify' inválido.*vercel, heroku, cloudrun/))
it('JSON quebrado → erro citando o arquivo', () =>
  expect(() => parseDeployConfig('{')).toThrow(/deploy\.config\.json: JSON inválido/))
it('cloudrun sem bloco → erro', () =>
  expect(() => parseDeployConfig('{"host":"cloudrun"}')).toThrow(/cloudrun: bloco obrigatório/))
it('cloudrun com campo vazio → erro com o caminho do campo', () => /* uat.serviceAccount = '' */
  expect(() => parseDeployConfig(JSON.stringify(cfgCom({ uat: { serviceAccount: '' } })))).toThrow(/cloudrun\.uat\.serviceAccount/))
it('cloudrun válido → devolve o bloco', () => expect(parseDeployConfig(JSON.stringify(CFG)).cloudrun?.prod.project).toBe('app-prod'))
it('heroku/vercel aceitam bloco extra sem validar', () => expect(parseDeployConfig('{"host":"heroku","heroku":{}}').host).toBe('heroku'))
```

(`CFG` = o exemplo do §5.1 da spec; `cfgCom` = helper que mescla um override.)

- [ ] **Step 2:** `npx vitest run tests/unit/deployConfig.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** `parseDeployConfig` / `lerDeployConfig` (validação à mão, mensagens prefixadas por `deploy.config.json:`).
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(deploy): lê e valida deploy.config.json` (inclui o teste no `managed` do manifesto).

---

### Task 2: espera do preview genérica

**Files:**
- Create: `scripts/deploy/aguardar.mjs` (move o corpo de `waitPreview` de `scripts/e2e/wait-preview.mjs`)
- Modify: `scripts/e2e/wait-preview.mjs` (vira fachada: reexporta `waitPreview`, `DEFAULT_TIMEOUT_MS`, `DEFAULT_INTERVAL_MS`; CLI igual, usando o predicado da Vercel)
- Test: `tests/unit/deployAguardar.test.ts`; `tests/unit/e2eWaitPreview.test.ts` **sem mudança**

**Interfaces:**
- Produces: `waitPreview({ api, sha, ambienteDePreview = (e) => e.startsWith('Preview'), timeoutMs, intervalMs, now, sleep }): Promise<{ url: string }>` — mesmo comportamento atual, com o filtro de ambiente injetável.

- [ ] **Step 1: Teste que falha** — `ambienteDePreview` customizado: com deployments `[{ environment: 'Preview' }, { environment: 'app-pr-12' }]` e predicado `(e) => e === 'app-pr-12'`, resolve com a URL do status do segundo; deployment que não casa é ignorado até o timeout (`Nenhum deploy de preview para <sha>`).
- [ ] **Step 2:** `npx vitest run tests/unit/deployAguardar.test.ts` → FAIL.
- [ ] **Step 3: Implementar** a extração; a fachada mantém a CLI e a mensagem `wait-preview: …`.
- [ ] **Step 4:** `npx vitest run tests/unit/deployAguardar.test.ts tests/unit/e2eWaitPreview.test.ts` → PASS (os testes antigos sem nenhuma edição).
- [ ] **Step 5: Commit** — `refactor(deploy): espera do preview com ambiente injetável`.

---

### Task 3: contrato, adaptadores Vercel/Heroku e CLI

**Files:**
- Create: `scripts/deploy/hosts/vercel.mjs`, `scripts/deploy/hosts/heroku.mjs`, `scripts/deploy/index.mjs`
- Test: `tests/unit/deployIndex.test.ts`

**Interfaces:**
- Consumes: `lerDeployConfig` (Task 1), `waitPreview` (Task 2), `makeGithubClient` (`scripts/github-api.mjs`).
- Produces: cada adaptador exporta `default` com
  `{ nome, ambienteDePreview(environment: string): boolean, deployPreview(ctx): Promise<void>, deployProd(ctx): Promise<void>, encerrarPreview(ctx): Promise<void> }`,
  `ctx = { config: DeployConfig, pr?: number, sha: string, exec: Exec, github: { call, paginate }, log: (msg: string) => void }`,
  `Exec = (cmd: string, args: string[]) => Promise<string>` (stdout).
  `index.mjs`: `adaptador(host): Adaptador`; `executar(operacao, { env, raiz, exec, github }): Promise<Record<string,string>>` — devolve os pares que a CLI grava em `$GITHUB_OUTPUT`.
  Operações da CLI (`node scripts/deploy/index.mjs <op>`): `host` → `{ host }`; `credenciais` (env `DEPLOY_AMBIENTE=uat|prod`) → `{ wifProvider, serviceAccount, project, region }` (vazio fora do cloudrun); `preview`, `prod`, `encerrar` (envs `PR_NUMBER`, `DEPLOY_SHA`); `aguardar` (env `PREVIEW_SHA`) → `{ url }`.
  Heroku: `ambienteDePreview` = o constatado na Task 0 (ou, se a Task 5 entrar, o adaptador sobrescreve `aguardar`).

- [ ] **Step 1: Testes que falham**

```ts
it.each(['vercel', 'heroku'])('%s: preview/prod/encerrar são no-op (exec nunca chamado)', async (host) => {
  const exec = vi.fn()
  for (const op of ['preview', 'prod', 'encerrar']) await executar(op, { env: envDe(host), exec, github })
  expect(exec).not.toHaveBeenCalled()
})
it('host → grava o host da config', async () => expect(await executar('host', ctxCloudRun)).toEqual({ host: 'cloudrun' }))
it('credenciais fora do cloudrun → vazio', async () => expect(await executar('credenciais', ctxVercel)).toEqual({}))
it('credenciais cloudrun prod → dados do bloco prod', async () =>
  expect((await executar('credenciais', { ...ctxCloudRun, env: { DEPLOY_AMBIENTE: 'prod' } })).project).toBe('app-prod'))
it('operação desconhecida → erro listando as válidas', async () =>
  await expect(executar('deploy', ctxVercel)).rejects.toThrow(/host, credenciais, preview, prod, encerrar, aguardar/))
it('vercel: ambienteDePreview = startsWith Preview', () => expect(adaptador('vercel').ambienteDePreview('Preview – app')).toBe(true))
```

(`envDe(host)`/`ctxCloudRun` escrevem um `deploy.config.json` num diretório temporário passado como `raiz`.)

- [ ] **Step 2:** `npx vitest run tests/unit/deployIndex.test.ts` → FAIL.
- [ ] **Step 3: Implementar** adaptadores e `index.mjs` (CLI no padrão `isMain` do `wait-preview.mjs`, prefixo de mensagem `deploy:`, `process.exit(1)` em erro).
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(deploy): contrato de host, adaptadores vercel e heroku e cli`.

---

### Task 4: adaptador Cloud Run

**Files:**
- Create: `scripts/deploy/hosts/cloudrun.mjs`
- Test: `tests/unit/deployCloudRun.test.ts`

**Interfaces:**
- Consumes: contrato e `ctx` da Task 3.
- Produces: `imagem(cfg, ambiente: 'uat'|'prod', tag: string): string` =
  `${region}-docker.pkg.dev/${amb.project}/${repository}/${amb.service}:${tag}`;
  `ambienteDePreview = (e) => e === 'Preview'`.

Comportamento (cada linha é uma chamada `exec` na ordem):

| Operação | Chamadas |
|---|---|
| `deployPreview` (UAT, tag `pr-<n>-<sha7>`) | `gcloud run services describe <svc> --project <p> --region <r> --format=value(metadata.name)` (falhou → erro "Serviço <svc> não existe em <p>: rode o Bootstrap de docs/runbooks/host-cloudrun.md"); `docker build -t <img> .`; `docker push <img>`; `gcloud run deploy <svc> --image <img> --project <p> --region <r> --tag pr-<n> --no-traffic`; `gcloud run services describe <svc> --project <p> --region <r> --format=json` → URL do `status.traffic[]` com `tag === 'pr-<n>'`. Depois `github.call('POST','/deployments',{ ref: sha, environment: 'Preview', auto_merge: false, required_contexts: [], transient_environment: true })` e `POST /deployments/<id>/statuses { state: 'success', environment_url: url }`. |
| `deployProd` (Prod, tag `main-<sha7>`) | `docker build`; `docker push`; `gcloud run deploy <svc> --image <img> --project <p> --region <r>`; `gcloud run services update-traffic <svc> --to-latest --project <p> --region <r>` |
| `encerrarPreview` | `gcloud run services update-traffic <svc> --remove-tags pr-<n> --project <p> --region <r>` (tag inexistente → `log` e sucesso) |

- [ ] **Step 1: Testes que falham** — um por linha da tabela, comparando `exec.mock.calls` com a lista exata; mais:
  - push novo no mesmo PR: `deployPreview` com `sha` B publica Deployment com `ref: B` e a tag de imagem `pr-12-<B7>` (Review Focus 3);
  - serviço inexistente: `exec` rejeita no `describe` → mensagem com `host-cloudrun.md`, e `docker` nunca chamado (Review Focus 4);
  - URL da tag ausente no JSON → erro `tag pr-12 sem URL`;
  - `encerrarPreview` com erro "tag not found" do gcloud → resolve.
- [ ] **Step 2:** `npx vitest run tests/unit/deployCloudRun.test.ts` → FAIL.
- [ ] **Step 3: Implementar** com `exec` injetado (padrão default `execFile` promisificado em `index.mjs`).
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(deploy): adaptador cloud run (tag por pr, prod por tráfego)`.

---

### Task 5 (condicional — só se a Task 0 Step 1 der "não"): Heroku pela Platform API

**Files:**
- Modify: `scripts/deploy/hosts/heroku.mjs`
- Test: `tests/unit/deployHeroku.test.ts`

**Interfaces:**
- Produces: `aguardarPreview({ sha, pipelineId, token, fetchFn, now, sleep, timeoutMs, intervalMs }): Promise<{ url }>` — `GET https://api.heroku.com/pipelines/<id>/review-apps` (`Accept: application/vnd.heroku+json; version=3`), escolhe o review app com `commit === sha`; `status: 'created'` → `GET /apps/<app.id>` → `web_url`; `errored` → erro; senão espera. Mesmo timeout/intervalo/retentativa 5xx-429 da Task 2. `index.mjs aguardar` usa este caminho quando o adaptador o expõe. `pipelineId` vem de `deploy.config.json` (`heroku.pipelineId`, validado na Task 1 só neste caso); `HEROKU_API_KEY` só por env.

- [ ] **Step 1: Testes que falham** — created → URL; errored → erro; SHA de outro PR ignorado; 503 transitório → tenta de novo; timeout com a mensagem da Task 2.
- [ ] **Step 2:** `npx vitest run tests/unit/deployHeroku.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** — `feat(deploy): heroku aguarda review app pela platform api`.

---

### Task 6: E2E — cabeçalhos de acesso por host e `appEnv` do exemplo

**Files:**
- Modify: `tests/e2e/support/env.ts` (campo `host` em `E2eEnv`; `cabecalhosDeBypass` → `cabecalhosDeAcesso`), `tests/e2e/support/test.ts` (usa `cabecalhosDeAcesso`; comentário do topo sem "Vercel" como único host)
- Modify: `examples/walking-skeleton/src/shared/appEnv.ts`
- Test: `tests/unit/e2eEnv.test.ts`, `examples/walking-skeleton/tests/unit/appEnv.test.ts`

**Interfaces:**
- Produces: `E2eEnv.host: 'vercel' | 'heroku' | 'cloudrun'` lido de `DEPLOY_HOST` (vazio → `vercel`; inválido → erro, como `E2E_AUTH`); `cabecalhosDeAcesso(env: E2eEnv): Record<string,string> | null` — bypass só com `host === 'vercel'` e segredo; `null` nos demais. `cabecalhosDeBypass` fica como alias exportado por uma Release.

- [ ] **Step 1: Testes que falham**
  - `cabecalhosDeAcesso` com `host: 'cloudrun'` e `bypass` preenchido → `null`; `vercel` + bypass → os dois cabeçalhos atuais; `DEPLOY_HOST=netlify` → erro.
  - `isE2eLocalEnvironment({ APP_ENV: 'e2e', DYNO: 'web.1' })` → `false`; `{ APP_ENV: 'e2e', K_SERVICE: 'app' }` → `false`; teste `APP_ENV=e2e` sem nenhum dos três → `true`.
- [ ] **Step 2:** `npx vitest run tests/unit/e2eEnv.test.ts` e `cd examples/walking-skeleton && npx vitest run tests/unit/appEnv.test.ts` → FAIL.
- [ ] **Step 3: Implementar** (`!env.VERCEL && !env.DYNO && !env.K_SERVICE`; JSDoc citando as três plataformas).
- [ ] **Step 4:** mesmos comandos → PASS.
- [ ] **Step 5: Commit** — `feat(e2e): cabeçalhos de acesso por host e e2e local fora de qualquer host`.

---

### Task 7: workflows

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/e2e-regressao.yml`
- Test: `tests/unit/deployWorkflow.test.ts` (padrão de `demosWorkflow.test.ts`: lê o YAML como texto)

**Interfaces:**
- Consumes: CLI da Task 3 (`host`, `credenciais`, `preview`, `prod`, `encerrar`, `aguardar`).

`deploy.yml`:
- `on: pull_request: types: [opened, synchronize, reopened, closed]` e `push: branches: [main]`; `permissions: { contents: read, deployments: write, id-token: write }`.
- `concurrency`: PR → `deploy-pr-${{ github.event.pull_request.number }}` com `cancel-in-progress: true`; push → `deploy-prod` com `cancel-in-progress: false`.
- Passo `host` (`node scripts/deploy/index.mjs host`); se fork (`github.event.pull_request.head.repo.full_name != github.repository`) → aviso e fim.
- Só com `host == 'cloudrun'`: `credenciais` → `google-github-actions/auth@v2` (`workload_identity_provider`, `service_account`) → `google-github-actions/setup-gcloud@v2` → `gcloud auth configure-docker <region>-docker.pkg.dev --quiet`.
- Operação: PR fechado → `encerrar`; PR aberto/atualizado → `preview`; push → `prod`. Envs `PR_NUMBER`, `DEPLOY_SHA` (`pull_request.head.sha` ou `github.sha`), `GITHUB_TOKEN`.

`e2e-regressao.yml`:
- Passo "Aguardar o deploy Preview da Vercel" → "Aguardar o preview do PR", `node scripts/deploy/index.mjs aguardar` (mesmo `id: preview`, mesmo `if`).
- Passo `host` antes dele; `DEPLOY_HOST: ${{ steps.host.outputs.host }}` no passo do Playwright. `VERCEL_AUTOMATION_BYPASS_SECRET` segue como está. Com Heroku condicional (Task 5): `HEROKU_API_KEY` só no passo de espera.
- Comentários que dizem "Preview da Vercel" passam a "preview do PR".

- [ ] **Step 1: Testes que falham** — eventos e `types` do `deploy.yml`; os dois grupos de `concurrency` com seus `cancel-in-progress` (Review Focus 5); `id-token: write`; os passos `google-github-actions/*` todos com `if:` contendo `== 'cloudrun'` (Review Focus 2); guarda de fork; `e2e-regressao.yml` sem `wait-preview.mjs` e com `index.mjs aguardar`; `hooks/protect-main/config.json` não contém `Deploy`.
- [ ] **Step 2:** `npx vitest run tests/unit/deployWorkflow.test.ts` → FAIL.
- [ ] **Step 3: Escrever** os workflows.
- [ ] **Step 4:** → PASS; `npx vitest run tests/unit/e2eGrepRegressao.test.ts` continua PASS.
- [ ] **Step 5: Commit** — `ci(deploy): workflow deploy.yml e espera do preview pelo host`.

---

### Task 8: modelos de arquivos por host

**Files:**
- Create: `scripts/deploy/templates/cloudrun/Dockerfile`, `scripts/deploy/templates/cloudrun/.dockerignore`, `scripts/deploy/templates/heroku/Procfile`, `scripts/deploy/templates/heroku/app.json`
- Test: `tests/unit/deployTemplates.test.ts`

Valores fixos: `Dockerfile` multi-stage `node:20-alpine`, `npm ci` → `npm run build` → runner com `.next/standalone`, `.next/static`, `public`, `ENV PORT=8080`, `CMD ["node","server.js"]`, usuário não root. `.dockerignore`: `node_modules`, `.next`, `.git`, `.env*`, `tests`, `playwright-report`, `test-results`. `Procfile`: `web: npm start`. `app.json`: `{ "name", "environments": { "review": { "scripts": {} } }, "buildpacks": [{ "url": "heroku/nodejs" }] }` sem nenhuma env com valor (envs do review app herdam do pipeline).

- [ ] **Step 1: Testes que falham** — `Dockerfile` contém `standalone`, `PORT=8080` e `USER`; `.dockerignore` contém `.env*`; `app.json` é JSON válido sem chave `value` em `env`; `Procfile` = `web: npm start`.
- [ ] **Step 2:** → FAIL. **Step 3:** criar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** — `feat(deploy): modelos de dockerfile e procfile por host`.

---

### Task 9: runbooks de host, gerais neutros e migração

**Files:**
- Create: `docs/runbooks/host-vercel.md`, `docs/runbooks/host-heroku.md`, `docs/runbooks/host-cloudrun.md`, `docs/runbooks/migrar-host.md`
- Modify: `docs/runbooks/bootstrap-ambientes.md`, `deploy-uat.md`, `deploy-prod.md`, `rollback.md`, `segredos-e-env.md`, `e2e-uat-configurar.md`, `README.md` (catálogo; nota "stack padrão Vercel" → "host do `deploy.config.json`"), `_TEMPLATE.md` (Pre-flight: "scope do host")
- Modify: `scripts/check-runbooks.mjs`, `tests/unit/checkRunbooks.test.ts`

Formato do runbook de host: as 7 seções obrigatórias do ADR-013 continuam (o checker não muda de estrutura). Os blocos **Bootstrap, UAT, Prod, Rollback, Segredos e envs, Cron, Encerrar** ficam como subtítulos `###` dentro de `## Passos`, numeração contínua — _(decisão: evita mexer no parser)_. Os runbooks gerais referenciam o bloco: `[R1] Apontar o UAT fixo para o preview: bloco **UAT** do runbook do host (host-<host>.md).` + `Verificar:` mantido.

Conteúdo mínimo:
- `host-vercel.md`: os comandos `vercel …` que hoje estão nos gerais, **movidos sem mudar**.
- `host-heroku.md`: criar pipeline, apps `-uat`/`-prod`, review apps automáticos com destruição no fechamento, auto-deploy da `main` no `-prod`, copiar `scripts/deploy/templates/heroku/*` para a raiz, `heroku config:set` por app (R2), UAT fixo por slug (`POST /apps/<app>-uat/releases` com o `slug` da release do review app), `heroku releases:rollback`, Heroku Scheduler, custo dos dynos, o padrão do Auth0 (Task 0).
- `host-cloudrun.md`: projetos GCP por ambiente + conta de faturamento + **alerta de orçamento**, APIs (`run`, `artifactregistry`, `iamcredentials`), Artifact Registry com a política de limpeza (5 mais novas; `pr-*` > 7 dias), pool/provider WIF + service account (`roles/run.admin`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`) e o preenchimento do `deploy.config.json`, copiar `scripts/deploy/templates/cloudrun/*` e `output: 'standalone'` no `next.config`, primeiro deploy da `main` em cada ambiente, envs do app com `gcloud run services update --update-env-vars` (R2), UAT fixo = `gcloud run services update-traffic <svc> --update-tags uat=<revisão>`, rollback = `--to-revisions <anterior>=100`, Cloud Scheduler (3 jobs grátis), `min-instances=0`, padrão do Auth0 (Task 0).
- `migrar-host.md`: §6.6 da spec, com a lista do que é código do app (`@vercel/node`, `@vercel/blob`, `VERCEL_*` lidas pelo app).

Checker (`MIN_CLASS_COMMANDS`): somar `heroku releases:rollback` (min 2), `heroku apps:destroy` (2), `heroku config:set` (2), `gcloud run services update-traffic` (2, salvo `--remove-tags`/`--update-tags` → livre), `gcloud run services delete` (2), `gcloud projects delete` (2). Ponto de atenção: `--update-tags` em UAT é R1; a regra mínima só vale para `--to-revisions`/`--to-latest`.

- [ ] **Step 1: Testes que falham** em `checkRunbooks.test.ts`: `heroku releases:rollback` em `[R1]` → erro "exige no mínimo [R2]"; `gcloud run services update-traffic … --to-revisions` em `[R1]` → erro; `--update-tags uat=` em `[R1]` → ok; o catálogo real (`checkCatalog('docs/runbooks')`) → sem erros.
- [ ] **Step 2:** `npx vitest run tests/unit/checkRunbooks.test.ts` → FAIL.
- [ ] **Step 3: Escrever** checker + runbooks.
- [ ] **Step 4:** mesmo comando → PASS; `npm run check:runbooks` → `check-runbooks: ok`; `rg -n 'vercel ' docs/runbooks --glob '!host-vercel.md' --glob '!migrar-host.md'` → só menções em texto, nenhum comando.
- [ ] **Step 5: Commit** — `docs(runbooks): runbooks por host e runbooks gerais neutros`.

---

### Task 10: ADR-018 e documentos gerais

**Files:**
- Create: `docs/adr/template/018-camada-de-deploy.md` (a partir de `docs/adr/000-template.md`)
- Modify: `docs/adr/template/002-estrategia-de-ambientes.md` (linha apontando para o ADR-018 no "Fora de escopo"), `ARCHITECTURE.md` (Vercel Cron → cron do host; tabela de stack cita os três; fluxo nativo "função serverless" → "backend no host"), `CLAUDE.md` (nota "Adoção — host" com `deploy.config.json` e ADR-018; regra 9 e 10 sem "Vercel" como único), `docs/guides/deploy-ci-guide.md`, `.claude/commands/deploy-staging.md`, `.claude/commands/deploy-prod.md`, `.claude/skills/runbook-execution/SKILL.md` (descrição cita o runbook do host)
- Test: `tests/unit/docsLinks.test.ts` (já existe — tem de continuar verde)

ADR-018: contexto (bloqueio corporativo, 4 projetos), decisão (§4–§5 da spec), consequências (custos: Vercel grátis/Hobby; Heroku Eco ~US$ 5/mês por conta ou Basic ~US$ 7/app; Cloud Run ~US$ 0 com cartão, alerta de orçamento e limpeza do registry), alternativas (B, C, Cloudflare/Amplify/Azure como hosts futuros).

- [ ] **Step 1:** escrever os documentos.
- [ ] **Step 2:** `npx vitest run tests/unit/docsLinks.test.ts` → PASS; `rg -n -i 'vercel' ARCHITECTURE.md CLAUDE.md .claude/commands` → só menções como uma das opções.
- [ ] **Step 3: Commit** — `docs(adr): adr-018 camada de deploy plugável`.

---

### Task 11: template-sync — manifesto e nota da migração dos runbooks

**Files:**
- Modify: `template-sync.manifest.json` (todos os testes novos de `tests/unit/deploy*.test.ts` no `managed`; `deploy.config.json` em `ignore`)
- Modify: `.claude/skills/template-sync/SKILL.md` (nota: na Release desta mudança, os valores preenchidos dos runbooks gerais vão para `host-vercel.md`; listar em **Juntados**)
- Test: `tests/unit/templateSyncManifest.test.ts`, `tests/unit/templateSyncSkill.test.ts`

- [ ] **Step 1: Teste que falha** em `templateSyncSkill.test.ts`: a skill menciona `host-vercel.md` e "Juntados" na mesma nota; em `templateSyncManifest.test.ts`: `deploy.config.json` está em `ignore`.
- [ ] **Step 2:** → FAIL. **Step 3:** editar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** — `chore(template-sync): manifesto e nota da camada de deploy`.

---

### Task 12 (condicional — só se a Task 0 Step 2 der "não"): URL do PR no Auth0 de UAT

**Files:**
- Create: `scripts/deploy/auth0Callbacks.mjs`
- Modify: `scripts/deploy/index.mjs` (após `preview` / antes de terminar `encerrar`, se `AUTH0_MGMT_*` presentes)
- Test: `tests/unit/deployAuth0Callbacks.test.ts`

**Interfaces:**
- Produces: `registrarUrl({ dominio, clientId, token, url, fetchFn })` e `removerUrl(...)` — `GET /api/v2/clients/<id>` → soma/remove `url + '/api/auth/callback'` em `callbacks` e `url` em `allowed_logout_urls` → `PATCH`. Idempotente (URL já presente → sem PATCH). Segredos `AUTH0_MGMT_CLIENT_ID`/`AUTH0_MGMT_CLIENT_SECRET` só no GitHub; token por client credentials.

- [ ] **Step 1:** testes: soma sem duplicar; remove só a URL do PR; idempotência; erro HTTP → mensagem sem o token.
- [ ] **Step 2:** → FAIL. **Step 3:** implementar. **Step 4:** → PASS.
- [ ] **Step 5: Commit** — `feat(deploy): registra a url do preview no auth0 de uat`.

---

### Task 13: verificação final

- [ ] **Step 1:** `npm run lint && npm run type-check && npm test && npm run check:runbooks && npm run check:cenarios` → tudo verde (colar a saída no PR).
- [ ] **Step 2: CA-10** — se o humano tiver as contas: repositório pessoal de teste com o `examples/walking-skeleton` copiado para a raiz, `deploy.config.json` `cloudrun` e depois `heroku`, um PR de teste cada → `Regressão (UAT)` verde, URL do preview no comentário do bot. Sem contas → CA-10 `parcial` na conferência spec × código.
- [ ] **Step 3:** conferência spec × código no template de PR (CA-1…CA-10), UAT desmarcado; push + PR (regras 0, 5 e 8 do `CLAUDE.md`).

---

## Constatações

Registradas em 2026-11-15, pela documentação oficial (sem conta de teste disponível).

1. **Heroku → GitHub Deployment**: o Heroku diz que "quando um deploy é feito a partir de um
   Review app, a integração GitHub do Heroku publica um deployment status com um link"
   (devcenter.heroku.com/articles/github-integration), mas **não documenta o nome do
   `environment`** e recomenda não inferir nada do nome do app (nomes aleatórios por padrão).
   **Decisão: a Task 5 entra** — o Heroku aguarda pela Platform API (`review-apps` do pipeline
   filtrado por SHA), que não depende de nome não documentado. `HEROKU_API_KEY` só no GitHub;
   `heroku.pipelineId` obrigatório no `deploy.config.json` quando `host: heroku`.
   `ambienteDePreview` do Heroku fica `() => false` (não usado).
2. **Auth0 → curinga**: aceito só no subdomínio mais à esquerda, um por URL, **com prefixo/sufixo
   no mesmo rótulo** (`https://prefix-*-suffix.example.com`); a documentação desaconselha em
   produção (aqui é só o tenant de UAT).
   - **Cloud Run**: a URL da tag é `https://<tag>---<serviço>-<hash>.<sufixo>.run.app`; o padrão
     `https://pr-*---<serviço>-<hash>.<sufixo>.run.app` cobre só revisões do próprio serviço
     (o hash é do projeto) → **curinga no runbook**, sem código.
   - **Heroku**: review apps têm nome aleatório em `herokuapp.com` (domínio compartilhado — um
     curinga ali aceitaria apps de terceiros). **Decisão: a Task 12 entra, só para o host
     `heroku`** (registrar/remover a URL do review app no Auth0 de UAT pela Management API).
     Com Heroku, a URL vem do `aguardar` (Task 5); o registro roda no passo de espera do
     `e2e-regressao.yml` e a remoção no `encerrar` do `deploy.yml`.
