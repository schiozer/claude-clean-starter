# Spec: Proteção da `main` — só via PR, aplicada por máquina

**Data**: 2026-10-23
**Status**: Aprovada
**Autor(es)**: Fabio Schiozer + Claudinho

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano e a
> implementação.

## 1. Contexto e Objetivo

A regra "toda mudança entra na `main` via PR" já existe (CLAUDE.md regras 8 e 10,
[ADR-005](../../adr/005-trunk-based-development.md),
[ADR-013](../../adr/013-governanca-operacional-e-runbooks.md) — merge na `main` é `[R3]`,
do humano). Mesmo assim, **em projetos derivados do template o agente pergunta, ao terminar
um trabalho, "posso fazer commit e merge na `main`?"** (a forma varia).

Causa provável:

1. A skill `superpowers:finishing-a-development-branch` oferece, no fim do trabalho, a opção
   "merge back to main locally". Nada no `CLAUDE.md` diz explicitamente que essa opção é
   proibida, e o roteiro da skill vence a regra genérica.
2. A regra é **só texto**: nada impede tecnicamente o agente de commitar na `main`, mergear
   para ela, dar push nela ou rodar `gh pr merge`.

**Objetivo**: em todo projeto derivado, chegar à `main` é **só via PR, sem exceção** — e o
merge do PR é do humano. O agente nem *oferece* outro caminho: trabalho terminado = commit na
feature branch → push → PR → avisar o humano ("abri o PR #N; o merge é seu").

**Sucesso** = (a) o agente nunca mais pergunta se pode commitar/mergear na `main`; (b) se
tentar, o comando é **barrado** por um hook que viaja com o template e a mensagem de bloqueio o
reorienta para branch + PR; (c) o comportamento é coberto por testes no CI.

## 2. Não-Objetivos

- Versionamento (SemVer/tags), CHANGELOG, template de PR, estratégia de merge (squash) e
  commitlint — ficam para uma entrega seguinte (ver §9).
- Restringir o **humano**: o hook só atua sobre comandos que o agente executa (tool Bash do
  Claude Code). O humano no próprio terminal não é afetado; para ele o backstop é a branch
  protection do GitHub (já prevista no `bootstrap-ambientes.md`, passo 10).
- Configurar a branch protection deste repositório (é `[R3]`, do humano).
- Mecanismo de liberação/override: **não existe**. "Pode fazer o merge" dito pelo humano não
  libera nada — o agente responde que o merge é dele e indica o PR.

## 3. Fluxo do Usuário (agente + humano)

**Happy path** — agente termina uma tarefa:

1. Se está na `main`, cria `tipo/descrição-curta` antes do primeiro commit.
2. Commita na feature branch, faz push, abre (ou atualiza) o PR contra a `main`
   (com o pre-flight de conta git da regra 5).
3. Informa: "PR #N aberto: <url>. O merge é seu." — **sem perguntar** sobre commit/merge na
   `main`.
4. Na `finishing-a-development-branch`, só a opção "push + PR" é válida; as opções "merge
   local" e "descartar" não são oferecidas (descartar só se o humano pedir).

**Desvio** — agente tenta um comando proibido:

1. O hook `PreToolUse` barra o comando (exit 2) antes de executar.
2. A mensagem (stderr, lida pelo agente) diz o que foi barrado e o caminho certo:
   "Bloqueado: a `main` só recebe mudanças via PR (CLAUDE.md regra 0, ADR-005). Crie uma
   branch `tipo/descrição`, faça push e abra o PR; o merge é do humano."
3. O agente segue o caminho certo, sem pedir ao humano para liberar.

## 4. Componentes

| Componente | Responsabilidade |
|---|---|
| `hooks/protect-main/run.mjs` | Hook `PreToolUse` (matcher `Bash`). Lê o JSON do stdin (`tool_input.command`, `cwd`), avalia e sai com `0` (permite) ou `2` + mensagem no stderr (bloqueia). |
| `hooks/protect-main/evaluate.mjs` (ou export do mesmo arquivo) | Função pura `evaluateCommand(command, ctx)` → `{ allowed: true } \| { allowed: false, reason }`. `ctx` = `{ currentBranch, protectedBranches }`. Testável sem git. |
| `hooks/protect-main/config.json` | `{ "protectedBranches": ["main"] }`. **Sem** chave `enabled` — o hook não tem botão de desligar. |
| `.claude/settings.json` | Registra o hook em `PreToolUse` (matcher `Bash`), invocando `node` direto (sem wrapper `run.sh`), e adiciona `permissions.deny` só para `gh pr merge` (reforço; regras de deny são por prefixo e fáceis de contornar — o hook é a defesa principal). |
| `CLAUDE.md` | Novo bloco **regra 0 — inegociável** no topo das regras obrigatórias (ver §5.3). Nota de adoção: o bloco e o hook não são removidos em projetos derivados. |
| `SKILLS.md` | Linha para `superpowers:finishing-a-development-branch`: só "push + PR". |
| `docs/adr/005-trunk-based-development.md` | Nova seção **Aplicação**: hook do agente + branch protection do humano. |
| `docs/adr/013-…` | Referência ao hook na linha `[R3]` (push direto na `main`, merge). |
| `CONTRIBUTING.md` | Menção curta ao hook. |
| `tests/unit/protectMain.test.ts` | Unit da função pura + integração do `run.mjs` num repo git temporário. |

Escolha de implementação (decisão do Claudinho): **Node (`.mjs`)**, não bash — o parsing de
comandos compostos é mais robusto e testável, e segue o padrão de `scripts/check-runbooks.mjs`.
Node já é pré-requisito do template.

## 5. Regras de Negócio

### 5.1 Determinação da branch atual

- Branch atual = `git symbolic-ref --short HEAD` no diretório efetivo do comando: `cwd` do
  payload, ajustado por `cd <dir>` anterior na mesma linha e por `git -C <dir>`.
- Dentro de uma linha composta (`&&`, `||`, `;`, `|`, quebra de linha), `git switch <b>` /
  `git checkout <b>` / `git switch -c <b>` / `git checkout -b <b>` **atualizam** a branch
  assumida para os segmentos seguintes (ex.: `git switch main && git commit …` → barrado).
- Fora de um repositório git, ou HEAD destacado: só valem as regras independentes de branch
  (`gh pr merge`, push explícito para branch protegida).
- Worktrees: `git -C <dir efetivo> symbolic-ref` já resolve a branch do worktree; há teste
  específico.

### 5.1.1 Parsing do comando

- Tokenizador próprio que respeita aspas simples/duplas, escapes e **heredocs** — o padrão
  `git commit -m "$(cat <<'EOF' … EOF)"` é o mais comum do agente; quebras de linha e a
  palavra "main" dentro da mensagem **não** contam como segmentos nem como alvo.
- Desembrulha antes de avaliar: `bash -c "…"` / `sh -c "…"` / `zsh -c "…"` (avalia o conteúdo,
  recursivo), prefixos `env VAR=… `, `VAR=… `, `command `, `time `, e as opções globais do git
  (`-C <dir>`, `-c k=v`, `--git-dir=…`, `--work-tree=…`, `--no-pager`).
- Aliases do git: se o subcomando não é nativo, resolve via `git config --get alias.<nome>` e
  avalia a expansão.
- **Ambiguidade relevante → bloqueia (fail-closed)**: se o comando contém `git` ou `gh` e o
  hook não consegue determinar com segurança se é uma operação proibida (ex.: `eval`,
  `$(…)`/backticks fora de argumento de mensagem, alias com `!` shell, variável no lugar do
  subcomando ou do refspec), bloqueia com mensagem pedindo o comando em forma literal.
  Comandos sem `git`/`gh` nunca são bloqueados por ambiguidade.

### 5.2 O que é barrado (branch protegida = qualquer item de `protectedBranches`)

| # | Comando | Condição |
|---|---|---|
| B1 | `git commit` (qualquer flag, inclusive `--amend`) | branch atual protegida |
| B2 | `git merge <x>` (com quaisquer flags) | branch atual protegida, exceto `<x>` = `<remote>/<mesma branch>` (equivale a `pull`). `FETCH_HEAD` e qualquer outro alvo → bloqueia |
| B3 | `git rebase`, `git cherry-pick`, `git revert`, `git am`, `git apply --index`/`--cached` | branch atual protegida, exceto `git rebase [flags] <remote>/<mesma branch>` |
| B4 | `git pull <remote> <x>` | branch atual protegida e `<x>` ≠ a própria branch |
| B5 | `git push` com refspec cujo destino é branch protegida: `main`, `+main`, `HEAD:main`, `<x>:main`, `<x>:refs/heads/main` | sempre |
| B6 | `git push` sem refspec, `git push <remote>`, `git push -u <remote> HEAD` | branch atual protegida |
| B7 | `git push --all` / `--mirror` | sempre |
| B8 | `gh pr merge` (qualquer forma) | sempre |
| B9 | `gh api` cujo caminho termina em `/merge` (pulls) ou `/merges` | sempre |

### 5.3 O que é permitido explicitamente

- `git switch main`, `git checkout main`, `git pull` / `git pull --rebase` / `git pull --ff-only`
  na `main` (atualizar a `main` local), `git fetch`, `git status`, `git log`, `git diff`.
- `git reset --hard origin/main` na `main` (descartar estado local).
- Tudo em feature branches, inclusive `git push --force-with-lease` (a regra de não dar
  force-push em branch compartilhada continua sendo do ADR-013, não deste hook).
- `git push origin --delete <feature>`.
- `--abort`, `--quit` e `--skip` de `merge`/`rebase`/`cherry-pick`/`revert`/`am` em qualquer
  branch (sair de um estado intermediário nunca é barrado). `--continue` segue a regra do
  comando original na branch atual.

### 5.4 Bloco "regra 0" no `CLAUDE.md`

Texto categórico, curto, antes da regra 1, cobrindo:

- A `main` só recebe mudanças via PR. Sem exceção, inclusive se o humano pedir.
- Trabalho terminado = commit em feature branch → push → PR → avisar. **Nunca pergunte** se
  pode commitar, mergear ou dar push na `main` — essa pergunta é proibida.
- O merge do PR é sempre do humano (`[R3]`); o agente nunca roda `gh pr merge`.
- Em `superpowers:finishing-a-development-branch` (ou qualquer skill que ofereça merge local),
  a única opção válida é "push + PR".
- O hook `hooks/protect-main` impõe isso; se ele barrar, siga a mensagem — não peça para
  desligá-lo.

### 5.5 Falhas do próprio hook

- Comando reconhecido como proibido → **sempre** bloqueia (exit 2).
- Erro interno do hook (payload ilegível, exceção, git indisponível para descobrir a branch):
  - se o texto do comando contém `git` ou `gh` → **bloqueia** (fail-closed), com mensagem
    explicando que o hook falhou e não deve ser desligado;
  - senão → permite, com aviso no stderr (um hook quebrado não pode travar `npm test`, `ls`…).
- `node` fora do PATH: o Claude Code reporta erro não-bloqueante do hook. Mitigação: o
  `run.mjs` é invocado como `node "$CLAUDE_PROJECT_DIR/hooks/protect-main/run.mjs"` e o
  pré-requisito Node está no README; o backstop remoto é a branch protection.

## 6. Dados / Queries

Não se aplica (sem persistência). Única configuração: `hooks/protect-main/config.json`.

## 7. Testes

- **Unit (`evaluateCommand`)**: uma tabela com cada linha B1–B9 (bloqueado) e cada item de
  §5.3 (permitido), mais: comandos compostos (`cd x && git commit`, `git switch main && git
  commit`), `git -C <dir>`, aspas na mensagem de commit contendo "main" (`git commit -m "fix
  main"` numa feature branch → permitido), `protectedBranches` com mais de um item.
- **Unit — parsing**: heredoc de commit com "main" no corpo numa feature branch (permitido) e
  na `main` (bloqueado); `bash -c "git push origin main"`; `env X=1 git commit`; `git -c k=v
  commit`; alias (`co = commit`); `eval "git push"` e `git push origin $BRANCH` (bloqueados por
  ambiguidade); `--abort`/`--continue`.
- **Integração (`run.mjs`)**: repo git temporário (`mkdtemp` + `git init -b main`), spawn via
  `execFileSync` com git real; payload JSON no stdin; verificar exit `2` + mensagem na `main`
  e exit `0` numa feature branch; worktree de uma feature branch; payload inválido com `git`
  no texto → exit `2`; payload inválido sem `git`/`gh` → exit `0` com aviso.
- **Config**: `.claude/settings.json` registra o hook em `PreToolUse`/`Bash` e contém o deny
  de `gh pr merge` (teste lê o JSON).

## 8. Critérios de Aceitação

- [ ] Na `main`, `git commit`, `git merge feature/x`, `git push`, `git push origin main`,
      `git push origin HEAD:main` e `gh pr merge 1` são barrados com a mensagem de reorientação.
- [ ] Numa feature branch, commit/push/PR funcionam normalmente; `git pull` na `main` funciona.
- [ ] `config.json` não tem chave de desligar.
- [ ] `CLAUDE.md` tem a regra 0 com a proibição explícita da pergunta e o override da
      `finishing-a-development-branch`; `SKILLS.md`, ADR-005, ADR-013 e `CONTRIBUTING.md`
      atualizados.
- [ ] `npm run lint`, `npm run type-check`, `npm test` e `npm run check:runbooks` verdes.
- [ ] Entregue por PR a partir de `feat/protecao-main-por-pr` (merge do humano).

## 9. Itens Futuros

- ADR-014 "Release management": SemVer + tag após deploy de Prod, CHANGELOG, squash merge
  com título do PR no formato de commit, política de versão do template (hoje `1.0.0` nos
  docs × `0.1.0` no `package.json`).
- `.github/pull_request_template.md`, commitlint no CI, `CODEOWNERS`.
- Corrigir o `deploy-ci-guide.md` ("descomente o job `build`" não corresponde ao `ci.yml`) e o
  `rollback.md` (`git revert -m 1` presume merge commit, mas o histórico usa squash).

## 10. Decisões do Claudinho (para conferência)

- Node (`.mjs`, chamado direto pelo `settings.json`) em vez de bash.
- Fail-closed para comandos com `git`/`gh` quando o hook falha ou não consegue decidir;
  fail-open para os demais (§5.1.1, §5.5) — derivado do "sem exceção" do humano.
- `permissions.deny` só para `gh pr merge`; o resto é do hook.
- Regra nova numerada como **0** para não renumerar as regras 1–10 citadas em outros docs.
- Projetos derivados herdam hook + `settings.json` ao copiar o template; a garantia de que
  continuam registrados é o teste de config no CI (sem script `check:*` novo).
- Feature toggle: **não** — é governança, sem botão de desligar (o humano pediu a regra sem
  exceção nem liberação).
- Tool MCP: não se aplica.
