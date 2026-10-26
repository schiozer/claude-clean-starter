# Release management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gates de saúde em todo PR (padrão do título, spec vinculada, spec × código pelo Claude sob toggle, UAT marcado pelo humano), alarme na Guarda da main para merge que fura gate, e uma versão SemVer + GitHub Release por merge.

**Architecture:** Scripts Node puros e testáveis em `scripts/` (`pr-gate.mjs`, `spec-gate.mjs`, `release.mjs`, `main-guard.mjs` estendido) sobre um cliente REST compartilhado (`scripts/github-api.mjs`); os workflows só leem o evento e chamam os scripts. O gate com Claude usa `anthropics/claude-code-action` com saída estruturada e roda só com `vars.SPEC_GATE == 'on'`. A camada 2 (`hooks/protect-main/evaluate.mjs`) ganha a regra "agente não marca UAT".

**Tech Stack:** Node ≥20 (ESM `.mjs`, JSDoc, só `node:` built-ins, `fetch` nativo), Vitest, GitHub Actions + REST API, `anthropics/claude-code-action@v1`.

**Spec:** `docs/superpowers/specs/2026-10-25-release-management-design.md`

## Global Constraints

- Sem dependências npm novas; só `node:` built-ins.
- Regex do título: `^(feat|fix|refactor|docs|style|test|chore|ci|perf|build|revert)(\([a-z0-9-]+\))?!?: .+`, ≤ 72 caracteres.
- Nomes de check exatos: `PR gate`, `Spec × código`, `Test & Lint (root)`, `Walking Skeleton (example)`.
- Toggle: variável de repositório `SPEC_GATE`; só o valor exato `on` liga. Modelo: `vars.SPEC_GATE_MODEL`, default `claude-sonnet-5-5`. Secret: `ANTHROPIC_API_KEY`.
- Marcador do comentário: `<!-- spec-gate -->`.
- Rótulo do alarme novo: `merge-sem-gates`; título `Merge sem gates: #<PR> (<sha7>)`. O alarme `main-sem-pr` existente não muda.
- Specs válidas: caminho em `docs/superpowers/specs/`, termina em `.md`, não é `_TEMPLATE.md`.
- Tags `vX.Y.Z` anotadas; sem tag → 1ª versão = `version` do `package.json` (`0.1.0`), sem bump.
- Nenhuma conta git/gh concreta em código, docs ou testes (template agnóstico de conta).
- Idioma: docs/mensagens pt-BR; código em inglês, `camelCase`. Prettier: sem `;`, aspas simples, `printWidth` 100.
- Commits `tipo(escopo): msg`, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Branch `feat/release-management`. Nunca commit/push na `main`, nunca `gh pr merge`, nunca marcar UAT.

## Review Focus

- **Editar o PR sem mudar `Spec:`/tabela depois de um veredito vermelho** → o novo run do `Spec × código` não pode virar verde só por não re-analisar (a Guarda lê o run mais recente). O run pulado reproduz o resultado do comentário anterior. Teste em Task 3.
- **Corpo do PR com CRLF** (edição pela UI do GitHub) → `Spec:`, UAT e tabela continuam reconhecidos. Teste em Task 1 (`parseUat`/`parseSpecLine` com `\r\n`).
- **Placeholders do template não preenchidos** (`Spec: <caminho …>`, `UAT não se aplica — <motivo>` marcado) → recusados como vazios, não aceitos. Teste em Task 1.
- **Tags fora do padrão ou pré-release** (`v1.2`, `v1.2.3-rc.1`, `release-1`) → ignoradas no cálculo; a maior tag numérica vence (`v0.10.0` > `v0.9.0`). Teste em Task 4.
- **PR mergeado cujo check ficou `cancelled`/`skipped` por concorrência** → não conta como sucesso; alarme lista o check. Teste em Task 2.

---

### Task 1: Template de PR + PR gate

**Files:**
- Create: `.github/pull_request_template.md`, `scripts/pr-gate.mjs`, `.github/workflows/pr-gate.yml`
- Test: `tests/unit/prGate.test.ts`

**Interfaces:**
- Produces (consumidos pelas Tasks 2–4):
  - `export const TITLE_PATTERN: RegExp`, `export const MAX_TITLE_LENGTH = 72`
  - `export function parseTitle(title: string): { type: string, scope: string | null, breaking: boolean } | null`
  - `export function parseSpecLine(body: string): { kind: 'path', path: string } | { kind: 'na', reason: string } | { kind: 'error', message: string }` — exatamente uma linha `^Spec:\s*(.+)$` (multiline); `n/a` casa `^n/a\s*[—-]\s*(.*)$`; motivo vazio ou só `<…>` → `error`.
  - `export function parseUat(body: string): { present: boolean, approved: boolean, notApplicable: boolean, reason: string }` — linhas `- [ ] UAT aprovado` e `- [ ] UAT não se aplica — <motivo>`, `[x]`/`[X]`, case-insensitive; `present` = as duas linhas existem; `reason` = '' se vazio ou só `<…>`.
  - `export function checkPr(input: { title: string, body: string, action: string, fileExists: (path: string) => boolean }): string[]` — lista de erros em pt-BR, cada um com a correção; `[]` = ok.
  - CLI: lê `GITHUB_EVENT_PATH` (`action`, `pull_request.title`, `pull_request.body`), `fileExists` = `existsSync` relativo ao cwd (checkout do head); imprime os erros e sai 1 se houver.

- [ ] **Step 1: Testes** (`it.each`), em `tests/unit/prGate.test.ts`:
  - título: aceita `feat(release): add gate`, `fix: x`, `feat!: x`, `refactor(api)!: x`; recusa `Feat: x`, `feature: x`, `feat(API): x`, `feat:x`, título de 73 caracteres; `parseTitle('feat(a)!: x')` → `{ type: 'feat', scope: 'a', breaking: true }`.
  - spec: sem linha → erro; duas linhas → erro; `Spec: docs/superpowers/specs/x.md` com `fileExists` true → ok, false → erro; `Spec: docs/adr/x.md` → erro; `Spec: docs/superpowers/specs/_TEMPLATE.md` → erro; `Spec: docs/superpowers/specs/../../x.md` → erro; `Spec: <caminho ou n/a — motivo>` → erro; `Spec: n/a — fix do bug #12` em `fix`/`docs` → ok; `Spec: n/a —` → erro; `Spec: n/a — x` em `feat`, `refactor`, `fix!` → erro.
  - UAT: seção ausente → erro; `opened` com `[x] UAT aprovado` → erro com "o UAT é marcado pelo humano depois de testar"; `edited` com `[x] UAT aprovado` → ok; `opened` com `[X] UAT não se aplica — docs` → erro.
  - CRLF: corpo válido com `\r\n` → `[]`.
  - template: `checkPr` sobre o conteúdo de `.github/pull_request_template.md` com título válido e `opened` → contém só o erro da linha `Spec:` (prova que as seções de §4.1 existem e vêm desmarcadas); o arquivo contém `## O quê`, `## Por quê`, `## Spec × código`, `## Checklist`, `## UAT`.
  - config: `pr-gate.yml` tem `types: [opened, edited, synchronize, reopened]`, `branches: [main]`, `name: PR gate`, `contents: read` e `ref: ${{ github.event.pull_request.head.sha }}`.
- [ ] **Step 2:** `npx vitest run tests/unit/prGate.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `scripts/pr-gate.mjs` (funções puras + CLI com guarda `import.meta` igual a `main-guard.mjs`) e o template (§4.1 da spec; tabela `| Critério (seção "Critérios de Aceitação" da spec) | Onde é atendido (arquivo/teste) | Status |`; checklist = "Checklist Antes de Commitar" do `CLAUDE.md`; linha `Spec: <caminho ou n/a — motivo>`; comentário HTML curto lembrando que o UAT é marcado só pelo humano).
- [ ] **Step 4: Workflow** `pr-gate.yml`: `on.pull_request` conforme o teste; `permissions: { contents: read }`; job `name: PR gate`; `actions/checkout@v5` no head sha; `actions/setup-node@v5` (`node-version: '20'`); `run: node scripts/pr-gate.mjs`. Sem `npm ci`.
- [ ] **Step 5:** `npx vitest run tests/unit/prGate.test.ts && npm run lint && npm run type-check` → PASS.
- [ ] **Step 6: Commit** — `feat(ci): pr gate valida título, spec e seção de uat`

---

### Task 2: Cliente GitHub compartilhado + Guarda da main estendida

**Files:**
- Create: `scripts/github-api.mjs`
- Modify: `scripts/main-guard.mjs`, `.github/workflows/main-guard.yml`, `hooks/protect-main/config.json`
- Test: `tests/unit/mainGuard.test.ts`, `tests/unit/githubApi.test.ts`

**Interfaces:**
- Consumes: `parseUat` (Task 1).
- Produces:
  - `export function makeGithubClient(opts: { token: string, repository: string, apiUrl?: string, fetchFn?: typeof fetch, userAgent: string }): { call(method: string, path: string, body?: unknown): Promise<unknown>, paginate(path: string, pick?: (page: unknown) => unknown[]): Promise<unknown[]> }` — `path` relativo a `/repos/{repository}`; headers atuais do `main-guard.mjs`; erro HTTP → `Error` com status e path. `makeGithubApi` do `main-guard.mjs` passa a usá-lo (comportamento igual).
  - `config.json`: `{ "protectedBranches": ["main"], "requiredChecks": ["Test & Lint (root)", "Walking Skeleton (example)", "PR gate"], "specGateCheck": "Spec × código" }`.
  - `PullInfo` passa a `{ number, title, body, merged_at, base: { ref }, head: { sha } }`.
  - `GuardApi` ganha `checkRuns(sha): Promise<{ name: string, status: string, conclusion: string | null }[]>` (`commits/{sha}/check-runs?filter=latest`, paginado) e `commitParents(sha): Promise<string[]>`.
  - `export function evaluateGates(pr: PullInfo, ctx: { checkRuns: CheckRun[], parents: string[], requiredChecks: string[] }): string[]` — itens faltando em pt-BR: `check "<nome>" ausente`, `check "<nome>" com conclusão <c>`, `UAT não marcado`, `UAT "não se aplica" sem motivo`, `duas opções de UAT marcadas`, `merge commit (2 pais): use squash`.
  - `runMainGuard(event, api, opts)`: `opts` ganha `requiredChecks?: string[]` e `specGate?: boolean` (default: lidos de `config.json` e `process.env.SPEC_GATE === 'on'`); se `specGate`, `specGateCheck` entra na lista. Retorno: `{ ok, offending, gateFailures: { pr: number, sha: string, missing: string[] }[] }`; `ok = offending.length === 0 && gateFailures.length === 0`.

- [ ] **Step 1: Testes** (API fake estendida, `delayMs: 0`):
  - PR mergeado + todos os checks `success` + `[x] UAT aprovado` + 1 pai → `ok`, nenhuma issue.
  - check `PR gate` ausente → `gateFailures[0].missing` contém `check "PR gate" ausente`; `createIssue` com título `Merge sem gates: #7 (ccccccc)` e rótulo `merge-sem-gates`.
  - conclusão `failure`, `skipped`, `cancelled` → alarme cada uma.
  - `Spec × código` ausente com `specGate: false` → ok; com `specGate: true` → alarme e o corpo cita re-rodar o check se `SPEC_GATE` foi ligado com o PR aberto.
  - UAT desmarcado → alarme; `[x] UAT não se aplica — ` (sem motivo) → alarme; `[x] UAT não se aplica — só docs` → ok; as duas marcadas → alarme.
  - `commitParents` com 2 SHAs → alarme `merge commit`.
  - issue aberta com `merge-sem-gates` → `comment`, não `createIssue`.
  - os testes existentes de `main-sem-pr` continuam passando sem alteração de expectativa (só o fake ganha os campos novos).
  - config: todo item de `requiredChecks` e `specGateCheck` aparece como `name:` de job em `.github/workflows/*.yml`; `main-guard.yml` tem `checks: read` e `SPEC_GATE: ${{ vars.SPEC_GATE }}`.
  - `githubApi.test.ts`: `paginate` segue páginas até uma página com menos de 100 itens; erro 404 → rejeita com o path na mensagem.
- [ ] **Step 2:** `npx vitest run tests/unit/mainGuard.test.ts tests/unit/githubApi.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** `findUnmerged` passa a devolver também o PR mergeado de cada commit; gates avaliados por PR único (dedupe por número), usando o head sha do PR para `checkRuns` e o commit da `main` para `commitParents`; as retentativas existentes envolvem a leitura dos checks. Comentário de topo do arquivo cita a spec 2026-10-25 §4.5.
- [ ] **Step 4: Workflow:** `permissions` + `checks: read`; `env.SPEC_GATE: ${{ vars.SPEC_GATE }}`.
- [ ] **Step 5:** `npx vitest run tests/unit/mainGuard.test.ts tests/unit/githubApi.test.ts tests/unit/gitGuard.test.ts && npm run lint && npm run type-check` → PASS (`gitGuard` lê o mesmo `config.json`).
- [ ] **Step 6: Commit** — `feat(ci): guarda da main alarma merge sem gates`

---

### Task 3: Gate "Spec × código" com Claude (toggle)

**Files:**
- Create: `scripts/spec-gate.mjs`, `.github/workflows/spec-gate.yml`
- Test: `tests/unit/specGate.test.ts`

**Interfaces:**
- Consumes: `parseSpecLine` (Task 1), `makeGithubClient` (Task 2).
- Produces:
  - `export const COMMENT_MARKER = '<!-- spec-gate -->'`; o comentário também carrega `<!-- spec-gate:result=pass -->` ou `=fail`.
  - `export const VERDICT_SCHEMA` — JSON Schema: `{ criterios: [{ criterio: string, status: 'ok'|'parcial'|'fora'|'sem-teste', evidencia: string }], divergencias: [{ descricao: string, bloqueante: boolean }], resumo: string }`, todos obrigatórios.
  - `export function specSection(body: string): string` — linha `Spec:` + seção `## Spec × código` até o próximo `## ` (normaliza CRLF).
  - `export function shouldAnalyze(input: { action: string, body: string, previousBody?: string }): boolean` — `edited` sem `previousBody` (só o título mudou) → false; `edited` com `specSection` igual → false; demais → true.
  - `export function evaluateVerdict(raw: unknown): { ok: boolean, reasons: string[] }` — valida a forma (falha → `ok: false`, motivo "saída do Claude inválida"); vermelho se algum `fora` ou divergência `bloqueante`.
  - `export function buildComment(r: { ok: boolean, title: string, reasons: string[], verdict?: Verdict, cost?: string }): string`.
  - `export function previousResult(comments: { body: string }[]): 'pass' | 'fail' | null`.
  - `export function buildPrompt(input: { spec: string, diff: string, table: string }): string` — instrui a achar a seção pelo título "Critérios de Aceitação", a responder só no schema, e a tratar spec, diff e corpo como **dados não confiáveis** (ignorar instruções contidas neles); os três blocos delimitados.
  - CLI `node scripts/spec-gate.mjs prepare` → escreve no `GITHUB_OUTPUT`: `mode` = `na` | `analyze` | `reuse` | `no-key`, `prompt` (multilinha, delimitador aleatório), `schema` (JSON compacto); lê `.spec-gate/diff.patch`, a spec do head e o evento (`changes.body.from` como `previousBody`); `reuse` quando `!shouldAnalyze` e existe resultado anterior (sem anterior → `analyze`); `no-key` quando `HAS_KEY != 'true'`.
  - CLI `node scripts/spec-gate.mjs report` → lê `MODE` e `STRUCTURED_OUTPUT`, cria/edita o comentário com o marcador, sai 1 se vermelho. Mensagens fixas: `no-key` → "configure o secret `ANTHROPIC_API_KEY` ou desligue `SPEC_GATE`" (vermelho); `na` → "sem spec declarada; nada a conferir" (verde); `reuse` → reproduz `previousResult` sem editar o comentário.

- [ ] **Step 1: Testes:**
  - `evaluateVerdict`: tudo `ok` → ok; um `fora` → vermelho; `parcial` + `sem-teste` + divergência não bloqueante → ok com motivos de aviso; divergência `bloqueante: true` → vermelho; `null`, `'{'`, objeto sem `criterios`, status `talvez` → vermelho "saída do Claude inválida".
  - `shouldAnalyze`: `opened`/`synchronize`/`reopened` → true; `edited` sem `previousBody` → false; `edited` marcando só `[x] UAT aprovado` → false; `edited` mudando a linha `Spec:` → true; `edited` mudando uma célula da tabela → true; mesma seção com CRLF vs LF → false.
  - `previousResult`: comentário com `result=fail` → `'fail'`; sem marcador → null; vários → o que tem o marcador.
  - `buildComment` começa com `<!-- spec-gate -->` e contém `result=pass|fail` coerente com `ok`.
  - `buildPrompt` contém "Critérios de Aceitação", "não confiáveis" e os três blocos.
  - config `spec-gate.yml`: `if: vars.SPEC_GATE == 'on'`; `name: Spec × código`; `types: [opened, synchronize, reopened, edited]`; `cancel-in-progress: true` com grupo pelo número do PR; `permissions` exatamente `contents: read` e `pull-requests: write` (sem `id-token`); `anthropics/claude-code-action@` fixado por SHA de commit com comentário `# v1.x.y`; `claude_args` contém `--allowedTools Read,Grep,Glob` e `--json-schema`; `github_token: ${{ secrets.GITHUB_TOKEN }}`; modelo `${{ vars.SPEC_GATE_MODEL || 'claude-sonnet-5-5' }}`; sem `track_progress`.
- [ ] **Step 2:** `npx vitest run tests/unit/specGate.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `scripts/spec-gate.mjs`.
- [ ] **Step 4: Workflow** — passos: checkout do head (`fetch-depth: 0`); setup-node 20; `git diff origin/${{ github.base_ref }}...HEAD > .spec-gate/diff.patch`; `prepare` (`id: prepare`, `env.HAS_KEY: ${{ secrets.ANTHROPIC_API_KEY != '' }}`); action (`id: claude`) só se `steps.prepare.outputs.mode == 'analyze'`, com `anthropic_api_key`, `github_token`, `prompt: ${{ steps.prepare.outputs.prompt }}`, `claude_args` com modelo, ferramentas e `--json-schema '${{ steps.prepare.outputs.schema }}'`; `report` com `if: always()`, `MODE` e `STRUCTURED_OUTPUT: ${{ steps.claude.outputs.structured_output }}`. Antes de fixar o SHA, confirmar no repositório da action (release `v1` mais recente) que os inputs `prompt`, `claude_args`, `github_token` e o output `structured_output` existem; se algum nome divergir, use o nome real e registre no relatório.
- [ ] **Step 5:** `npx vitest run tests/unit/specGate.test.ts && npm run lint && npm run type-check` → PASS.
- [ ] **Step 6: Commit** — `feat(ci): gate spec × código com claude atrás de SPEC_GATE`

---

### Task 4: Release por merge

**Files:**
- Create: `scripts/release.mjs`, `.github/workflows/release.yml`
- Test: `tests/unit/release.test.ts`

**Interfaces:**
- Consumes: `parseTitle`, `parseSpecLine`, `parseUat` (Task 1); `makeGithubClient` (Task 2).
- Produces:
  - `export function bumpType(title: string, body: string): 'major' | 'minor' | 'patch'` — `!` no título ou `/\bBREAKING[ -]CHANGE\b/` no corpo → major; `feat` → minor; resto → patch.
  - `export function nextVersion(tags: string[], change: { title: string, body: string }, packageVersion: string): string` — só tags `^v(\d+)\.(\d+)\.(\d+)$`, maior numérica; nenhuma → `packageVersion`.
  - `export function buildReleaseNotes(input: { title: string, prNumber: number | null, prUrl: string | null, body: string, specGate: 'ok' | 'pulado' | 'vermelho', commits: string[] }): string` — título, link do PR, link da spec (`parseSpecLine`; `n/a` → o motivo), `Spec × código` e UAT (`aprovado` | `n.a. — <motivo>` | `não marcado`), lista de commits se > 1.
  - `export async function runRelease(event: { before: string, after: string }, api: ReleaseApi, opts: { packageVersion: string }): Promise<{ created: boolean, tag: string | null }>`.
  - `ReleaseApi = { tags(): Promise<{ name: string, sha: string }[]>, pullsForCommit(sha), commitMessage(sha): Promise<string>, compare(base, head): Promise<string[]>, checkRuns(sha), createTag(tag: string, sha: string, message: string): Promise<void>, createRelease(tag: string, name: string, body: string): Promise<void> }` — `tags` via `GET /tags` (sha = commit); `createTag` = `POST git/tags` (anotada, `type: commit`) seguido de `POST git/refs` com `refs/tags/<tag>`.

- [ ] **Step 1: Testes:**
  - `nextVersion([], feat, '0.1.0')` → `0.1.0`; `['v0.1.0']` + `fix` → `0.1.1`; + `feat` → `0.2.0`; + `feat!` → `1.0.0`; `['v0.4.2']` + `fix` com corpo `BREAKING CHANGE: x` → `1.0.0`; `['v0.9.0','v0.10.0']` + fix → `0.10.1`; `['v1.2','v1.2.3-rc.1','release-1','v0.3.0']` + fix → `0.3.1`.
  - `runRelease`: tag já aponta para `after` → `{ created: false }`, nada criado; PR mergeado → `createTag('v0.2.0', after, <título>)` e `createRelease('v0.2.0', 'v0.2.0 — <título>', <notas>)`; sem PR → usa a 1ª linha de `commitMessage`; `Spec × código` ausente nos checks → notas com `pulado`.
  - `buildReleaseNotes`: contém `#12` e o link do PR, o link `docs/superpowers/specs/x.md`, `UAT: aprovado`; com 2 commits lista ambos.
  - config `release.yml`: `on.push.branches: [main]`; `permissions` `contents: write`, `pull-requests: read`, `checks: read`; `concurrency.group: release` e `cancel-in-progress: false`.
- [ ] **Step 2:** `npx vitest run tests/unit/release.test.ts` → FAIL.
- [ ] **Step 3: Implementar** (CLI lê `GITHUB_EVENT_PATH`, `package.json` do checkout, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`; `before` zero → só o `after`).
- [ ] **Step 4: Workflow** conforme o teste; checkout + setup-node 20 + `node scripts/release.mjs`.
- [ ] **Step 5:** `npx vitest run tests/unit/release.test.ts && npm run lint && npm run type-check` → PASS.
- [ ] **Step 6: Commit** — `feat(ci): tag semver e github release a cada merge`

---

### Task 5: Camada 2 — agente não marca UAT

**Files:**
- Modify: `hooks/protect-main/evaluate.mjs` (`checkGh`)
- Test: `tests/unit/protectMainEvaluate.test.ts`

**Interfaces:**
- Produces: motivo novo com `BLOCK_PREFIX`: "Marcar o UAT no PR é do humano (`[R3]`), depois de testar."

- [ ] **Step 1: Linhas novas** (`ON_FEAT`):
  - BLOCKED: `gh pr edit 3 --body "… - [x] UAT aprovado"`, `gh pr create --title "fix: x" --body "- [X] uat não se aplica — docs"`, `gh api -X PATCH repos/o/r/pulls/3 -f body='- [x] UAT aprovado'`, `gh api graphql -f query='mutation { updatePullRequest(input: {body: "- [x] UAT aprovado"}) { clientMutationId } }'`.
  - ALLOWED: `gh pr create --title "fix: x" --body "- [ ] UAT aprovado"`, `gh pr view 3`, `gh pr edit 3 --title "fix: y"`.
- [ ] **Step 2:** rodar → FAIL nas novas. **Step 3:** em `checkGh`, para `pr create|edit` e para `api` (qualquer endpoint), recusar se algum argumento casa `/\[x\]\s*uat\b/i`. **Step 4:** `npx vitest run tests/unit/protectMain*.test.ts && npm run lint` → PASS (inclusive as linhas existentes).
- [ ] **Step 5: Commit** — `feat(hooks): agente não marca o uat do pr`

---

### Task 6: Documentação e runbook

**Files:**
- Create: `docs/runbooks/spec-gate.md`, `docs/adr/014-release-management.md`
- Modify: `scripts/check-runbooks.mjs` (`REQUIRED_RUNBOOKS` + `'spec-gate.md'`), `docs/runbooks/README.md` (catálogo), `docs/runbooks/bootstrap-ambientes.md`, `docs/runbooks/deploy-prod.md`, `CLAUDE.md`, `BEST_PRACTICES.md`, `SKILLS.md`, `README.md`, `CONTRIBUTING.md`, `.claude/commands/deploy-staging.md`, `.claude/commands/uat.md`, `tests/unit/checkRunbooks.test.ts` (se listar o catálogo)

- [ ] **Step 1: Runbook `spec-gate.md`** no formato de `_TEMPLATE.md` (meta, Pre-flight, Passos, Verificação, Rollback, Registro), conforme spec §4.8: conta pessoal no console da Anthropic, crédito e limite mensal (`[R3]` humano); criar a chave e gravar o secret `ANTHROPIC_API_KEY` em Settings → Secrets → Actions (`[R2]`, humano, nunca colar no chat); `gh variable set SPEC_GATE --body on` (`[R1]`) e desligar com `gh variable delete SPEC_GATE`; opcional `SPEC_GATE_MODEL`; conferir num PR de teste o check `Spec × código` e o comentário; alerta de não usar chave/assinatura corporativa num repositório pessoal (regra 5); ligar com PRs abertos exige re-rodar o check neles.
- [ ] **Step 2: bootstrap** — passo novo `[R3]` humano: Settings → Pull Requests só "Allow squash merging" com "Default to pull request title"; verificação `gh api repos/<preencher: owner/repo> --jq '.allow_squash_merge, .allow_merge_commit, .allow_rebase_merge, .squash_merge_commit_title'` → `true false false PR_TITLE`. Passo 10 lista `PR gate` (e `Spec × código` se `SPEC_GATE=on`) nos checks esperados. **deploy-prod**: pré-condição "gates verdes e UAT marcado pelo humano no PR"; Registro cita a tag `vX.Y.Z` gerada.
- [ ] **Step 3: ADR-014** a partir de `000-template.md`: decisão (gates, squash, SemVer por merge, Releases como CHANGELOG, toggle permanente só no gate com Claude — critério de remoção do ADR-006 não se aplica), consequências, limites honestos (gate é visível + alarme, não bloqueio; UAT garantido por regra com conta compartilhada; workflow alterado no próprio PR), alternativas (release-please, commitlint, `CHANGELOG.md`, branch protection, conta separada para o agente).
- [ ] **Step 4: `CLAUDE.md`** — regra 0/8: entrega inclui o template de PR e a conferência local spec × código (§4.3) antes de `gh pr create`; regra 10 `[R3]` ganha "marcar o UAT no PR"; nota de adoção: não remover `pr-gate.yml`, `release.yml`, decidir `SPEC_GATE` (runbook `spec-gate.md`). **BEST_PRACTICES** (Git): squash obrigatório; título do PR = mensagem do commit e fonte da versão; versão por tag; Releases = CHANGELOG. **SKILLS.md**: linha da `finishing-a-development-branch`/verificação cita a conferência local e o template; runbook `spec-gate` na Operação. **README/CONTRIBUTING**: referências curtas (Releases, template, `SPEC_GATE`). **`.claude/commands/deploy-staging.md` e `uat.md`**: o PR usa o template com UAT desmarcado; o agente avisa que o UAT está pendente e nunca o marca.
- [ ] **Step 5:** `npm run lint && npm run type-check && npm test && npm run check:runbooks` → exit 0; `npx prettier --check` nos arquivos alterados → ok; `rg -n -i 'schiozer' -g '!docs/superpowers/**'` → sem conta nova introduzida.
- [ ] **Step 6: Commit** — `docs: adr-014 release management, runbook spec-gate e regras do uat`

---

### Entrega

- [ ] `superpowers:verification-before-completion` (checklist do `CLAUDE.md`).
- [ ] Conferência local spec × código (spec §4.3) preenchendo o template novo; UAT **desmarcado**.
- [ ] Pre-flight de conta (regra 5 + memória local), push da `feat/release-management`, PR; restaurar a conta padrão. **Merge e UAT são do humano.**
- [ ] Avisar o humano: gravar `ANTHROPIC_API_KEY`, `SPEC_GATE=on` e squash-only via runbooks.
