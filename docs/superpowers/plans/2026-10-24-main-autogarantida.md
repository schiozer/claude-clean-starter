# `main` autogarantida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o template garantir sozinho que a `main` só muda via PR, com três camadas: git hooks versionados que valem para todos, o hook do agente barrando o desligamento deles e um workflow do GitHub que detecta commit sem PR.

**Architecture:** Shims `sh` em `.githooks/` (`reference-transaction`, `pre-push`) delegam a `hooks/protect-main/git-guard.mjs` (funções puras + entrypoint), instalados por `scripts/install-git-hooks.mjs` (`prepare` do npm + SessionStart). `hooks/protect-main/evaluate.mjs` ganha regras contra desligar a camada 1. `scripts/main-guard.mjs` + `.github/workflows/main-guard.yml` checam a associação commit→PR mergeado.

**Tech Stack:** Node ≥20 (ESM `.mjs`, JSDoc, só `node:` built-ins), POSIX `sh`, git ≥2.28, Vitest, GitHub Actions + REST API.

**Spec:** `docs/superpowers/specs/2026-10-24-main-autogarantida-design.md`

## Global Constraints

- Sem dependências npm novas; só `node:` built-ins (o workflow usa `fetch` nativo do Node 20).
- Fonte única das branches protegidas: `hooks/protect-main/config.json` = `{"protectedBranches":["main"]}`. Sem chave de desligar, sem override.
- Mensagens de bloqueio começam com `BLOCK_PREFIX` de `hooks/protect-main/evaluate.mjs` (texto exato já existente) e terminam com a linha: `Atualizar a \`main\` local com \`git pull\` continua permitido.`
- Remoto de referência fixo: `origin`. Diretório dos hooks: `.githooks` (valor exato de `core.hooksPath`).
- Shims executáveis no índice do git (modo `100755`).
- Idioma: docs/mensagens pt-BR; código em inglês, `camelCase`. Prettier: sem `;`, aspas simples, `printWidth` 100.
- Commits `tipo(escopo): msg`, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Trabalho na branch `feat/protecao-main-por-pr` (PR #14). Nunca commit/push na `main`, nunca `gh pr merge`.

## Review Focus

- Commit numa **feature branch** com a camada 1 instalada → tem que passar sem chamar o Node (latência zero no dia a dia). Teste em Task 1 (shim não invoca Node: PATH sem `node` + commit em feature → ok).
- `git pull` na `main` atrás da `origin/main` (ff) → permitido; `git pull` com `pull.rebase=true` e sem commits locais → permitido. Teste em Task 1.
- `git checkout -b feat/x` partindo da `main` e `git switch main` → não são mudanças em `refs/heads/main`; permitidos. Teste em Task 1.
- Repositório clonado com o template mas **sem `npm install`** → nada instalado; a SessionStart instala. Teste em Task 2 (script idempotente aplicado em repo limpo).
- Push da feature branch quando a `main` local está atrás → `pre-push` só olha `remote-ref`; permitido. Teste em Task 1.

---

### Task 1: Guarda dos git hooks (`git-guard.mjs` + shims)

**Files:**
- Create: `hooks/protect-main/git-guard.mjs`, `.githooks/reference-transaction`, `.githooks/pre-push`
- Test: `tests/unit/gitGuard.test.ts` (puro), `tests/unit/gitGuardHooks.test.ts` (git real, como o `protectMainRun.test.ts`)

**Interfaces:**
- Consumes: `BLOCK_PREFIX` de `evaluate.mjs`; `config.json`.
- Produces:
  - `export function checkRefTransaction(lines: RefUpdate[], ctx: { protectedBranches: string[], originSha: (branch: string) => string | null }): string | null` — `RefUpdate = { oldSha, newSha, ref }`; retorna motivo (começa com `BLOCK_PREFIX`) ou `null`.
  - `export function checkPrePush(lines: PushUpdate[], protectedBranches: string[]): string | null` — `PushUpdate = { localRef, localSha, remoteRef, remoteSha }`.
  - Entrypoint: `node hooks/protect-main/git-guard.mjs reference-transaction <state>` | `pre-push <remote> <url>`, stdin repassado; exit 1 + stderr para recusar.
  - Shims localizam o guard e o `config.json` **a partir do diretório do próprio shim** (`$(dirname "$0")/../hooks/protect-main/`), não da raiz do repo.

- [ ] **Step 1: Testes puros** — tabela `it.each` com `ZERO = '0'.repeat(40)`, `originSha` por mapa:
  - recusa: `{old:A,new:C,ref:'refs/heads/main'}` com origin `B`; `{old:ZERO,new:C,ref:'refs/heads/main'}` com origin `B`; ref `refs/heads/release` com `protectedBranches:['main','release']`.
  - permite: `new === origin` (`B`); `new === ZERO`; `old === ZERO` e origin `null`; ref `refs/heads/feat/x`; ref `HEAD`; `new` igual ao `newSha` de uma linha `refs/remotes/origin/main` **no mesmo lote**.
  - `checkPrePush`: recusa `remoteRef:'refs/heads/main'` (inclusive com `localSha = ZERO`, delete); permite `refs/heads/feat/x`; recusa lote misto `[feat/x, main]`.
  - Motivo começa com `BLOCK_PREFIX` e termina com a linha final das Global Constraints; o de ref-transaction sugere `git pull --ff-only` ou `git reset --hard origin/main`.
  - `extractProtectedBranches` do shim: teste que roda `sh -c` com o trecho de extração do shim sobre `config.json` e compara com `JSON.parse(...).protectedBranches`.
- [ ] **Step 2:** `npx vitest run tests/unit/gitGuard.test.ts` → FAIL.
- [ ] **Step 3: Implementar `git-guard.mjs`** — `originSha` real via `git rev-parse --verify --quiet refs/remotes/origin/<b>`; só o estado `prepared` é avaliado. Qualquer exceção com linha de branch protegida → recusa.
- [ ] **Step 4: Shims `sh`** — lê stdin para variável; extrai nomes do `config.json` com `sed` POSIX; se alguma linha termina em ` refs/heads/<nome>` (ref-transaction: 3º campo; pre-push: 3º campo) → `printf '%s\n' "$input" | node .../git-guard.mjs <hook> "$@"`; senão sai 0. Extração vazia → chama o Node sempre. `node` ausente com linha protegida → mensagem + exit 1. `chmod +x` e `git update-index --chmod=+x`.
- [ ] **Step 5: Testes de integração** — `beforeEach`: `mkdtemp`, remoto bare `git init --bare -b main`, clone, `git config core.hooksPath <abs>/.githooks`, commit inicial na `main` e push **antes** de ligar o hooksPath. Casos (espera `status !== 0` + stderr com `BLOCK_PREFIX`, ou `0`):
  - recusa na `main`: `git commit --allow-empty -m x`; `git merge feat` (feat com 1 commit); `git update-ref refs/heads/main <sha-feat>`; `git -c alias.x=commit x --allow-empty -m y`; `node -e "require('child_process').execSync('git commit --allow-empty -m z')"`; `git branch -f main feat` a partir de `feat`.
  - permite: `git pull` na `main` atrás (um 2º clone **sem** hooksPath empurra um commit para a `main` do bare, simulando o merge de um PR); `git -c pull.rebase=true pull`; `git reset --hard origin/main`; `git fetch origin main:main` estando em `feat` (se o git não listar a ref remota na mesma transação, registrar e trocar o teste para "recusado" conforme a spec §4.2); `git switch -c feat/y` e `git switch main`.
  - commit inicial: `git init -b main` sem remoto + hooksPath → `git commit --allow-empty -m init` permitido; o segundo commit é recusado (spec §4.2 só libera `old = zero`).
  - `pre-push` (estando em `feat`): `git push origin feat` permitido; `git push origin HEAD:main`, `git push --all`, `git push --mirror`, `git -c push.default=matching push origin` (com `main` local divergente) recusados.
  - PATH sem `node` (PATH só com o dir do `git`): commit em `feat` permitido; commit na `main` recusado.
- [ ] **Step 6:** `npx vitest run tests/unit/gitGuard.test.ts tests/unit/gitGuardHooks.test.ts && npm run lint` → PASS.
- [ ] **Step 7: Commit** — `feat(hooks): git hooks versionados que travam a main localmente`

---

### Task 2: Instalação e autorreparo (`install-git-hooks.mjs`, `prepare`, SessionStart)

**Files:**
- Create: `scripts/install-git-hooks.mjs`
- Modify: `package.json` (`"prepare": "node scripts/install-git-hooks.mjs"`), `hooks/check-dependencies/run.sh` (bloco que chama o script e reporta)
- Test: `tests/unit/installGitHooks.test.ts`

**Interfaces:**
- Consumes: `.githooks/` (Task 1).
- Produces: `export function installGitHooks(dir: string): { action: 'skipped' | 'unchanged' | 'installed' | 'replaced', previous: string | null }` + CLI que imprime aviso no stderr em `replaced` e sempre sai 0 (salvo git quebrado → 1).

- [ ] **Step 1: Testes** — repo temporário:
  - fora de repo → `skipped`;
  - raiz do git ≠ `dir` (subpasta com `package.json`) → `skipped`;
  - `core.hooksPath` ausente → `installed`, `git config --get core.hooksPath` = `.githooks`;
  - já `.githooks` → `unchanged`;
  - `.husky` → `replaced`, `previous: '.husky'`, valor final `.githooks`;
  - `package.json` contém `prepare` exato; `git ls-files -s .githooks` mostra `100755` nos dois shims.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar (grava config **local**). **Step 4:** em `run.sh`, após o check do plugin: se `node` existe, `node "$PROJECT_DIR/scripts/install-git-hooks.mjs"`; se a ação for `installed`/`replaced`, imprime `protect-main: core.hooksPath reaplicado (.githooks).` Nunca falha a sessão.
- [ ] **Step 5:** `npx vitest run tests/unit/installGitHooks.test.ts && npm run lint && npm run type-check` → PASS; `npm install` local → `git config --get core.hooksPath` = `.githooks`.
- [ ] **Step 6: Commit** — `feat(hooks): instala a trava da main no npm install e na sessão`

---

### Task 3: Camada 2 — agente não desliga a trava

**Files:**
- Modify: `hooks/protect-main/evaluate.mjs`
- Test: `tests/unit/protectMainEvaluate.test.ts`

**Interfaces:**
- Consumes: estrutura existente de `evaluateGit` / `writesRedirectingConfig` / env inline `GIT_CONFIG_*` / `--config-env`.
- Produces: novos motivos de bloqueio (com `BLOCK_PREFIX`).

- [ ] **Step 1: Linhas novas** (todas `ON_FEAT`):
  - BLOCKED: `git config core.hooksPath x`, `git config --unset core.hooksPath`, `git config --global core.hooksPath /tmp/h`, `git config set core.hooksPath x`, `git -c core.hooksPath=/dev/null commit -m x`, `git --config-env=core.hooksPath=H commit -m x`, `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x`, `git push --no-verify origin feat/x`, `rm .githooks/pre-push`, `rm -rf .githooks`, `mv .githooks x`, `chmod -x .githooks/reference-transaction`, `echo > .githooks/pre-push`, `truncate -s 0 .githooks/pre-push`.
  - ALLOWED: `git push -n origin feat/x`, `git config core.hooksPath .githooks`, `git config --get core.hooksPath`, `cat .githooks/pre-push`, `git commit --no-verify -m x`.
- [ ] **Step 2:** rodar → FAIL nas novas. **Step 3:** implementar (chave `core.hooksPath` case-insensitive; o check de `.githooks` vale para qualquer comando, mesmo sem `git`). **Step 4:** `npx vitest run tests/unit/protectMain*.test.ts && npm run lint` → PASS (inclusive as 301 linhas existentes).
- [ ] **Step 5: Commit** — `feat(hooks): agente não pode desligar a trava local da main`

---

### Task 4: Camada 3 — workflow "Guarda da main"

**Files:**
- Create: `scripts/main-guard.mjs`, `.github/workflows/main-guard.yml`
- Test: `tests/unit/mainGuard.test.ts`

**Interfaces:**
- Produces: `export async function runMainGuard(event: PushEvent, api: GuardApi, opts?: { retries?: number, delayMs?: number }): Promise<{ ok: boolean, offending: string[] }>`
  - `GuardApi = { compare(base, head): Promise<string[]>, pullsForCommit(sha): Promise<{ merged_at: string | null, base: { ref: string } }[]>, findOpenIssue(label): Promise<number | null>, createIssue(title, body, label): Promise<void>, comment(issue, body): Promise<void> }`
  - `PushEvent = { ref, before, after, forced }` (do `GITHUB_EVENT_PATH`).
  - CLI: lê evento + `GITHUB_TOKEN` + `GITHUB_REPOSITORY`, implementa `GuardApi` com `fetch`, sai 1 se `!ok`.
- Valores fixos: label `main-sem-pr`; título `Commit na main sem PR: <sha7 de after>`; `retries: 3`, `delayMs: 10000`.

- [ ] **Step 1: Testes** (API fake): PR mergeado com `base.ref='main'` → `ok`; sem PR → `offending=[sha]`, `createIssue` chamado com o label; PR com `merged_at:null` → alarme; PR mergeado em outra base → alarme; `before` zeros → `ok`, `compare` não chamado; `forced:true` → alarme mesmo com PRs; issue aberta existente → `comment`, não `createIssue`; associação aparece só na 2ª tentativa (`delayMs:0`) → `ok`; branch fora de `protectedBranches` → `ok`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar.
- [ ] **Step 4: Workflow** — `on: push: branches: [main]`; `permissions: { contents: read, pull-requests: read, issues: write }`; `actions/checkout@v5`, `actions/setup-node@v5` (`node-version: '20'`), `run: node scripts/main-guard.mjs` com `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Sem `npm ci`. Teste de config no mesmo arquivo: gatilho `branches` do YAML (parse por regex da linha) ⊇ `protectedBranches`.
- [ ] **Step 5:** `npx vitest run tests/unit/mainGuard.test.ts && npm run lint && npm run type-check` → PASS.
- [ ] **Step 6: Commit** — `feat(ci): guarda da main detecta commit sem PR`

---

### Task 5: Documentação

**Files:**
- Modify: `docs/adr/005-trunk-based-development.md` (seção Aplicação), `docs/runbooks/bootstrap-ambientes.md` (passo 10), `CLAUDE.md` (regra 0 + nota de adoção + estrutura com `.githooks/`), `CONTRIBUTING.md`, `README.md`, `docs/superpowers/specs/2026-10-23-protecao-main-por-pr-design.md` (nota em §2)

- [ ] **Step 1:** ADR-005 conforme spec §7: três camadas; remover a frase a frase sobre branch protection como garantia real; branch protection opcional; limites (desligamento deliberado local, detecção remota não é prevenção, push que altera `main-guard.yml`, remoto com nome ≠ `origin`, `.git/hooks/*` deixam de rodar).
- [ ] **Step 2:** bootstrap passo 10: "`[R3]` Humano: se o plano permitir, ligar a branch protection…; senão, confirmar que o workflow `Guarda da main` está ativo em Actions." CLAUDE.md regra 0: "Nunca edite, desative ou contorne `hooks/protect-main`, `.githooks/` ou `core.hooksPath` (nem o `.claude/settings.json`…)"; nota de adoção inclui `.githooks/` e `main-guard.yml`. CONTRIBUTING/README: `npm install` instala a trava; se barrar, crie branch + PR; `git pull --ff-only` na `main`. Nota na spec anterior §2: "Revogado pela spec 2026-10-24: a trava vale também para o humano."
- [ ] **Step 3:** `npm run lint && npm run type-check && npm test && npm run check:runbooks && npx prettier --check .` → exit 0; `rg -n "garantia real é a branch" docs` → sem resultado.
- [ ] **Step 4: Commit** — `docs: main autogarantida em três camadas`

---

### Entrega

- [ ] `superpowers:verification-before-completion` (checklist do CLAUDE.md).
- [ ] Pre-flight de conta (regra 5): `gh auth switch --user schiozer` → `git -c credential.helper='!gh auth git-credential' push origin feat/protecao-main-por-pr` → atualizar a descrição do PR #14 → `gh auth switch --user fschiozerSFDC`. **Merge é do humano.**
