# Proteção da `main` por PR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hook `PreToolUse` que barra qualquer comando do agente que leve mudança à `main` sem PR (ou faça o merge do PR), mais a "regra 0" inegociável nos docs.

**Architecture:** Três módulos Node ESM em `hooks/protect-main/`: `parse.mjs` (tokeniza a linha de shell em segmentos argv, desembrulhando `bash -c`/`env`/prefixos e marcando ambiguidade), `evaluate.mjs` (função pura que aplica B1–B9 e as permissões de §5.3 sobre os segmentos, com dependências de git injetadas) e `run.mjs` (lê o payload do stdin, injeta git real, sai `0`/`2`). Registrado em `.claude/settings.json`.

**Tech Stack:** Node ≥20 (ESM, sem dependências novas), Vitest (já no projeto), git CLI.

**Spec:** `docs/superpowers/specs/2026-10-23-protecao-main-por-pr-design.md`

## Global Constraints

- Sem dependências npm novas; só `node:` built-ins.
- Branches protegidas vêm de `hooks/protect-main/config.json` = `{ "protectedBranches": ["main"] }`; **sem** chave `enabled`.
- Mensagem de bloqueio (prefixo fixo, seguido do motivo específico): `Bloqueado: a \`main\` só recebe mudanças via PR (CLAUDE.md regra 0, ADR-005). Crie uma branch \`tipo/descrição\`, faça push e abra o PR; o merge é do humano.`
- Bloqueio = exit `2` + mensagem no stderr; permissão = exit `0`.
- Comandos sem a palavra `git` ou `gh` nunca são bloqueados (nem por ambiguidade, nem por erro do hook).
- Idioma: docs e mensagens em pt-BR; nomes de código em inglês, `camelCase`.
- Prettier do projeto: sem `;`, aspas simples, `printWidth` 100.

## Review Focus

- Mensagem de commit via heredoc/aspas contendo `main`, `&&`, `;` ou quebras de linha numa feature branch → tem que ser permitida (falso positivo aqui torna o hook insuportável). Teste em Task 1 e Task 2.
- `git push` "seco" estando na `main` sem upstream configurado → bloqueado (B6). Teste em Task 2.
- `git switch -c feat/x && git commit …` partindo da `main` → permitido (a branch assumida muda antes do commit). Teste em Task 2.
- Comando que só menciona `git` como texto (`echo "use git push"`, `rg "git commit"`) → permitido (não é invocação de git). Teste em Task 2.
- Repo onde `git` não acha HEAD (repo recém-criado sem commits, `git init -b main`) → `symbolic-ref` ainda retorna `main`; commit nele é bloqueado. Teste em Task 3.

---

### Task 1: Tokenizador `parse.mjs`

**Files:**
- Create: `hooks/protect-main/parse.mjs`
- Modify: `eslint.config.mjs` (incluir `'hooks/**'` no override de `files` que hoje é `['tests/**', 'scripts/**']`)
- Test: `tests/unit/protectMainParse.test.ts`

**Interfaces:**
- Produces: `export function parseCommand(command: string): Segment[]` onde
  `Segment = { argv: string[], ambiguous: boolean }`. Separadores de segmento: `&&`, `||`, `;`, `|`, `&`, quebra de linha — **fora** de aspas/heredoc. `argv` já vem desembrulhado: sem atribuições `VAR=x` iniciais, sem `env [VAR=x…]`, `command`, `time`, `sudo`; `bash|sh|zsh -c "<s>"` é substituído pelos segmentos de `parseCommand(s)` (recursivo). `ambiguous: true` quando o segmento contém `$(…)`/backticks **fora** de um argumento que segue `-m`/`--message`/`-F`, contém `$VAR`/`${VAR}` em token não citado com aspas simples, ou começa com `eval`. Corpo de heredoc (`<<EOF`, `<<'EOF'`, `<<-EOF`) é descartado do argv e não gera segmentos.

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, it, expect } from 'vitest'
import { parseCommand } from '../../hooks/protect-main/parse.mjs'

const argvs = (c: string) => parseCommand(c).map((s) => s.argv)

describe('parseCommand', () => {
  it('splits on shell operators', () => {
    expect(argvs('cd x && git commit -m a; git push | cat')).toEqual([
      ['cd', 'x'], ['git', 'commit', '-m', 'a'], ['git', 'push'], ['cat'],
    ])
  })
  it('keeps quoted operators and newlines inside one token', () => {
    expect(argvs('git commit -m "fix main && deploy;\nmore"')).toEqual([
      ['git', 'commit', '-m', 'fix main && deploy;\nmore'],
    ])
  })
  it('ignores heredoc bodies used as commit message', () => {
    const c = "git commit -m \"$(cat <<'EOF'\nfeat: x\n\ngit push origin main\nEOF\n)\""
    const segs = parseCommand(c)
    expect(segs).toHaveLength(1)
    expect(segs[0].argv.slice(0, 3)).toEqual(['git', 'commit', '-m'])
    expect(segs[0].ambiguous).toBe(false)
  })
  it('unwraps bash -c recursively', () => {
    expect(argvs('bash -c "git switch main && git push"')).toEqual([
      ['git', 'switch', 'main'], ['git', 'push'],
    ])
  })
  it('strips env prefixes', () => {
    expect(argvs('env GIT_X=1 FOO=2 git commit')).toEqual([['git', 'commit']])
    expect(argvs('FOO=1 git push')).toEqual([['git', 'push']])
  })
  it('marks eval and variable refspecs as ambiguous', () => {
    expect(parseCommand('eval "git push"')[0].ambiguous).toBe(true)
    expect(parseCommand('git push origin $BRANCH')[0].ambiguous).toBe(true)
    expect(parseCommand("git push origin '$BRANCH'")[0].ambiguous).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/unit/protectMainParse.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar `parseCommand` em `hooks/protect-main/parse.mjs`** — scanner de caracteres com estados (normal, aspas simples, aspas duplas, `$(` aninhado com contador de profundidade, heredoc pendente até a linha delimitadora). JSDoc com o tipo `Segment` (o arquivo é `.mjs`, `allowJs` do tsconfig importa os tipos).
- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS; `npm run lint` → exit 0.
- [ ] **Step 5: Commit** — `git add hooks/protect-main/parse.mjs tests/unit/protectMainParse.test.ts eslint.config.mjs && git commit -m "feat(hooks): tokenizador de comandos do protect-main"`

---

### Task 2: Avaliador `evaluate.mjs` (regras B1–B9)

**Files:**
- Create: `hooks/protect-main/evaluate.mjs`
- Test: `tests/unit/protectMainEvaluate.test.ts`

**Interfaces:**
- Consumes: `parseCommand` (Task 1).
- Produces:
  - `export const BLOCK_PREFIX: string` — texto exato das Global Constraints.
  - `export function evaluateCommand(command: string, ctx: EvalContext): Verdict`
  - `EvalContext = { cwd: string, protectedBranches: string[], branchOf: (dir: string) => string | null, aliasOf: (dir: string, name: string) => string | null }`
  - `Verdict = { allowed: true } | { allowed: false, reason: string }` (`reason` começa com `BLOCK_PREFIX`).
- Semântica: percorre segmentos em ordem mantendo `dir` (atualizado por `cd <d>`, relativo ao anterior) e `branch` (inicial = `branchOf(dir)`; atualizado por `git switch|checkout [-c|-b|-C|-B] <b>`; `cd` recalcula via `branchOf`). `git -C <d>` avalia com `branchOf(d)` só naquele segmento. Opções globais do git (`-C`, `-c k=v`, `--git-dir=`, `--work-tree=`, `--no-pager`) são puladas para achar o subcomando. Subcomando não nativo → `aliasOf`; expansão com `!` → ambíguo; senão reavalia com a expansão. Segmento `ambiguous` cujo `argv[0]` é `git`/`gh`/`eval` → bloqueia ("não foi possível verificar; escreva o comando por extenso"). Regras B1–B9 e liberações exatamente como §5.2/§5.3 da spec (`--abort`/`--quit`/`--skip` sempre liberados).

- [ ] **Step 1: Escrever os testes** — tabela `it.each` com `ctx` fake (`branchOf` por mapa `{ '/repo': 'main', '/repo/wt': 'feat/x' }`, `aliasOf` por mapa `{ co: 'commit', sh: '!git push' }`):

| comando (cwd `/repo`, na `main`, salvo indicado) | esperado |
|---|---|
| `git commit -m x` / `git commit --amend` | bloqueia |
| `git -c user.name=a commit -m x` / `git co -m x` | bloqueia |
| `git merge feat/x` / `git merge --ff-only FETCH_HEAD` | bloqueia |
| `git merge origin/main` / `git merge --ff-only origin/main` | permite |
| `git rebase feat/x` / `git cherry-pick abc` / `git revert abc` | bloqueia |
| `git am p.patch` / `git apply --index p.patch` / `git merge --continue` | bloqueia |
| `git apply p.patch` (sem `--index`/`--cached`) | permite |
| `git rebase origin/main` / `git merge --abort` / `git rebase --abort` | permite |
| `git pull` / `git pull --rebase` / `git pull origin main` | permite |
| `git pull origin feat/x` | bloqueia |
| `git push` / `git push origin` / `git push -u origin HEAD` | bloqueia |
| `git push --all` / `git push --mirror` | bloqueia (também numa feature branch) |
| `git push origin main` / `+main` / `HEAD:main` / `x:refs/heads/main` (em `feat/x`) | bloqueia |
| `git push origin feat/x` / `git push --force-with-lease` (em `feat/x`) / `git push origin --delete feat/x` | permite |
| `gh pr merge 1` / `gh pr merge --squash` (em `feat/x`) | bloqueia |
| `gh api repos/o/r/pulls/1/merge -X PUT` / `gh api repos/o/r/merges` | bloqueia |
| `gh pr create --fill` / `gh pr view 1` | permite |
| `git switch main && git commit -m x` (começando em `feat/x`) | bloqueia |
| `git switch -c feat/y && git commit -m x` | permite |
| `cd wt && git commit -m x` / `git -C /repo/wt commit -m x` | permite |
| `git commit -m "fix main"` (em `feat/x`) | permite |
| `bash -c "git push origin main"` (em `feat/x`) | bloqueia |
| `eval "git push"` / `git push origin $B` / `git sh` | bloqueia (ambíguo) |
| `echo "git push origin main"` / `rg "git commit"` / `npm test` | permite |
| `git commit -m x` com `branchOf` → `null` (HEAD destacado) | permite |
| `git push origin release` com `protectedBranches: ['main','release']` | bloqueia |

Asserção de bloqueio: `expect(v.allowed).toBe(false); expect(v.reason.startsWith(BLOCK_PREFIX)).toBe(true)`.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/unit/protectMainEvaluate.test.ts` → FAIL.
- [ ] **Step 3: Implementar `evaluateCommand` em `hooks/protect-main/evaluate.mjs`** — uma função por família (`checkCommit`, `checkIntegrate` para merge/rebase/cherry-pick/revert/am/apply/pull, `checkPush`, `checkGh`), cada uma retornando `string | null` (motivo); `evaluateCommand` só orquestra estado `dir`/`branch`.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS; `npm run lint` → exit 0.
- [ ] **Step 5: Commit** — `git commit -m "feat(hooks): regras de bloqueio da main no protect-main"`

---

### Task 3: Entrypoint `run.mjs`, config e registro no Claude Code

**Files:**
- Create: `hooks/protect-main/run.mjs`, `hooks/protect-main/config.json`
- Modify: `.claude/settings.json`
- Test: `tests/unit/protectMainRun.test.ts`

**Interfaces:**
- Consumes: `evaluateCommand`, `BLOCK_PREFIX` (Task 2).
- Produces: processo `node hooks/protect-main/run.mjs` — stdin = payload JSON do Claude Code (`{ tool_name, tool_input: { command }, cwd }`); `branchOf(dir)` = `git -C dir symbolic-ref --quiet --short HEAD` (erro → `null`); `aliasOf(dir, n)` = `git -C dir config --get alias.<n>` (erro → `null`); config lida de `config.json` ao lado do script. Qualquer exceção: se o texto bruto do stdin contém `\bgit\b` ou `\bgh\b` → exit 2 com `BLOCK_PREFIX` + "o hook protect-main falhou; não o desligue — corrija o hook"; senão exit 0 com aviso no stderr.
- `.claude/settings.json`: adicionar em `hooks` a chave `PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/hooks/protect-main/run.mjs"' }] }]` e `permissions: { deny: ['Bash(gh pr merge)', 'Bash(gh pr merge *)'] }`, preservando o conteúdo atual.

- [ ] **Step 1: Escrever os testes** — `beforeEach`: `mkdtempSync`, `git init -b main`, `git config user.email/name`, commit inicial; helper `runHook(payload: string)` com `spawnSync('node', ['hooks/protect-main/run.mjs'], { input: payload })` retornando `{ status, stderr }`.
  - `should block commit on main` → `status === 2`, `stderr` contém `BLOCK_PREFIX`.
  - `should block commit on main in a repo without commits` (só `git init -b main`) → `2`.
  - `should allow commit on feature branch` (`git switch -c feat/x`) → `0`.
  - `should allow commit inside a feature worktree` (`git worktree add ../wt -b feat/wt`, `cwd` = worktree) → `0`.
  - `should fail closed on invalid payload mentioning git` (`'not json git push'`) → `2`.
  - `should fail open on invalid payload without git` (`'not json'`) → `0`, `stderr` não vazio.
  - `settings.json registers the hook and the deny rule` — lê `.claude/settings.json`, espera `PreToolUse[0].matcher === 'Bash'`, `command` contendo `hooks/protect-main/run.mjs`, e `permissions.deny` contendo `'Bash(gh pr merge *)'`.
  - `config.json has protectedBranches and no enabled key`.
- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run tests/unit/protectMainRun.test.ts` → FAIL.
- [ ] **Step 3: Implementar `run.mjs`, criar `config.json` e editar `settings.json`.**
- [ ] **Step 4: Rodar e ver passar** — `npm test` → todos PASS; `npm run lint && npm run type-check` → exit 0.
- [ ] **Step 5: Verificação manual no próprio Claude Code** — numa feature branch, tentar `git push origin main --dry-run` pelo agente → bloqueado com a mensagem; `git status` → executa.
- [ ] **Step 6: Commit** — `git commit -m "feat(hooks): registra protect-main como PreToolUse"`

---

### Task 4: Regra 0 e documentação

**Files:**
- Modify: `CLAUDE.md` (novo bloco antes de "### 1."; nota de adoção no topo; item na "Estrutura do Projeto" para `hooks/`), `SKILLS.md` (linha `superpowers:finishing-a-development-branch` na tabela "Revisão — Verificação"), `docs/adr/005-trunk-based-development.md` (seção `## Aplicação` antes de `## Consequências`), `docs/adr/013-governanca-operacional-e-runbooks.md` (linha `[R3]`: "imposto ao agente pelo hook `hooks/protect-main`"), `CONTRIBUTING.md` (seção "Conta git" ganha irmã "Proteção da `main`"), `README.md` (pré-requisito Node ≥20 para os hooks, se ainda não citado).

**Interfaces:**
- Consumes: caminho `hooks/protect-main/` e `config.json` (Task 3).

- [ ] **Step 1: Escrever a regra 0 no `CLAUDE.md`** com título `### 0. **A `main` só recebe mudanças via PR — INEGOCIÁVEL** ⛔` e os cinco pontos de §5.4 da spec, incluindo literalmente: "**Nunca pergunte** se pode commitar, mergear ou dar push na `main` — essa pergunta é proibida." e "Em `superpowers:finishing-a-development-branch` (ou qualquer skill que ofereça merge local), a única opção válida é **push + PR**." Nota de adoção: "Ao adotar o template, **não remova** a regra 0 nem `hooks/protect-main`."
- [ ] **Step 2: Atualizar SKILLS.md, ADR-005, ADR-013, CONTRIBUTING.md, README.md** conforme a lista de arquivos.
- [ ] **Step 3: Verificar** — `npm run lint && npm run type-check && npm test && npm run check:runbooks` → exit 0; `rg -n "regra 0" CLAUDE.md SKILLS.md docs/adr/005-trunk-based-development.md CONTRIBUTING.md` → ocorrências em todos.
- [ ] **Step 4: Commit** — `git commit -m "docs: regra 0 inegociável da main via PR e aplicação por hook"`

---

### Entrega

- [ ] `superpowers:verification-before-completion` (checklist do CLAUDE.md).
- [ ] Pre-flight de conta (regra 5): conta `schiozer` ativa → `git push -u origin feat/protecao-main-por-pr` → `gh pr create --base main` → restaurar `fschiozerSFDC`. **Merge é do humano.**
