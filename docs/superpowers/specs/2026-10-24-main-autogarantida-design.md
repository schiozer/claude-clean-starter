# Spec: `main` autogarantida — só via PR, sem depender da branch protection do GitHub

**Data**: 2026-10-24
**Status**: Aprovada
**Autor(es)**: Fabio Schiozer + Claudinho

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano e a
> implementação. Estende (e em parte revoga) a
> [spec de 2026-10-23](./2026-10-23-protecao-main-por-pr-design.md).

## 1. Contexto e Objetivo

A spec anterior entregou o hook `hooks/protect-main` (PreToolUse do Claude Code), uma guarda
**léxica** sobre os comandos Bash do agente, e tratava a **branch protection do GitHub** como a
garantia real. Mas o humano usa o plano gratuito do GitHub com repositório privado: **não há
branch protection disponível**. O template precisa **se autogarantir**.

Decisões do humano (literais):

- "o branch não tem proteção porque eu não pago o github, então vc precisa se autogarantir"
- "a trava é para todos, só via PR de outro branch" — vale para o agente **e** para o humano no
  próprio terminal (revoga o não-objetivo "Restringir o humano" da spec anterior, §2).
- Aprovou o desenho em três camadas descrito abaixo ("está ótimo").

**Objetivo**: em qualquer clone do template (ou projeto derivado) com as dependências
instaladas, a `main` local **não aceita** commit, merge, rebase, reset para outro ponto etc., e
**nenhum push** para a `main` sai da máquina — venha do agente, do humano, de `npm run`, `make`,
`node -e` ou de um script. O que escapar do lado local (cliente HTTP direto na API, máquina sem
os hooks, desligamento deliberado) é **detectado** no GitHub e vira alarme visível.

**Sucesso** = (a) os bypasses conhecidos do hook léxico (programas que chamam o git por dentro,
config gravada fora do agente, `git update-ref`/`branch -f`) deixam de funcionar localmente;
(b) a instalação é automática (`npm install`) e se autorrepara (SessionStart); (c) todo commit
que chegue à `main` sem PR mergeado gera check vermelho + issue; (d) coberto por testes no CI.

## 2. Não-Objetivos

- **Impedir** quem desliga as travas de propósito na própria máquina (`git -c core.hooksPath=`,
  `--no-verify` no push, apagar `.githooks/`). Localmente isso é impossível; a camada 3 detecta.
- Reverter automaticamente o que escapou (decisão do Claudinho — ver §10).
- Tornar o repositório público ou assinar o GitHub Pro. Fica documentado como opção que dá
  branch protection real, não como dependência.
- Release management (SemVer, CHANGELOG…) — continua em "Itens futuros" da spec anterior.
- Mecanismo de liberação/override: **não existe** (como na spec anterior).

## 3. Arquitetura — três camadas

```
Camada 1 (local, todos)    git hooks versionados em .githooks/ via core.hooksPath
  reference-transaction  → recusa mudar refs/heads/<protegida> salvo alinhar a origin/<protegida>
  pre-push               → recusa qualquer push cujo destino seja refs/heads/<protegida>
  instalação             → `prepare` do npm + SessionStart (verifica e reaplica)

Camada 2 (agente)          hooks/protect-main (já existe) ganha: barrar desligar a camada 1

Camada 3 (GitHub)          workflow "Guarda da main" em push na main → commit sem PR
                           mergeado = job vermelho + issue
```

Fonte única das branches protegidas: `hooks/protect-main/config.json`
(`{"protectedBranches":["main"]}`), lida pelas três camadas (a camada 3 lê o arquivo do checkout).

## 4. Camada 1 — git hooks versionados

### 4.1 Arquivos

| Arquivo | Papel |
|---|---|
| `.githooks/reference-transaction` | Shim `sh` executável; delega ao guard Node. |
| `.githooks/pre-push` | Shim `sh` executável; delega ao guard Node. |
| `hooks/protect-main/git-guard.mjs` | Lógica dos dois hooks (função pura + entrypoint), reutiliza `config.json`. |
| `scripts/install-git-hooks.mjs` | Aplica `git config core.hooksPath .githooks` (idempotente). |
| `package.json` | `"prepare": "node scripts/install-git-hooks.mjs"`. |

`.githooks/` na raiz (decisão do Claudinho): fica separado de `hooks/`, que são hooks do Claude
Code. `core.hooksPath` relativo resolve contra a raiz do worktree, então funciona em worktrees.

### 4.2 `reference-transaction`

Git ≥ 2.28 chama o hook com o estado (`prepared` | `committed` | `aborted`) e, no stdin, linhas
`<old-sha> <new-sha> <refname>`. Saída ≠ 0 no estado `prepared` aborta a transação inteira.
Só o estado `prepared` é avaliado; os demais saem 0.

Para cada linha cujo `refname` é `refs/heads/<protegida>`:

| Caso | Decisão |
|---|---|
| `new` = zero (apagar a branch local) | permite |
| `new` = valor de `refs/remotes/origin/<protegida>` (no repositório **ou** atualizado na mesma transação, ex.: `git fetch origin main:main`) | permite — é `pull`/ff/`reset --hard origin/main` |
| `old` = zero e `refs/remotes/origin/<protegida>` não existe | permite — commit inicial de um repo novo, antes de ter remoto |
| qualquer outro | **recusa** com a mensagem de §4.5 |

Efeito: barra `commit`, `commit --amend`, `merge` (de qualquer coisa que não seja
`origin/main`), `rebase`, `cherry-pick`, `revert`, `am`, `reset` para outro ponto,
`branch -f main X`, `update-ref refs/heads/main X` — **independente de quem chama** e sem ser
pulado por `--no-verify`. Linhas de outras refs (inclusive `HEAD` simbólico) não são avaliadas.

Ordem de leitura do `origin/<protegida>`: primeiro as linhas do próprio stdin (mesma
transação), depois o valor no repositório. O teste de `git fetch origin main:main` confirma
o comportamento real do git; se o git não listar a ref remota na mesma transação, o caso passa
a ser recusado e a mensagem indica `git pull --ff-only` (decisão do Claudinho).

`pull` permitido = **só fast-forward** até `origin/<protegida>`. `git pull --no-ff` ou um pull
que gere merge/rebase com commits locais produz SHA diferente e é recusado — correto, porque
seria mudança local na `main`. A mensagem sugere `git pull --ff-only` ou
`git reset --hard origin/main`.

Desempenho: o hook roda em **toda** transação de ref (fetch, commit em feature branch…). O shim
lê o stdin para uma variável, extrai os nomes protegidos do `config.json` com `sed` POSIX (um
teste garante que a extração do shim = `JSON.parse`) e só chama o Node, repassando o stdin,
quando alguma linha termina em ` refs/heads/<protegida>`. Se a extração não achar nenhum nome,
chama o Node sempre. Fail-closed: se há linha de branch protegida e o Node não roda (ausente,
erro), recusa.

### 4.3 `pre-push`

Stdin: `<local-ref> <local-sha> <remote-ref> <remote-sha>`. Recusa se **qualquer** linha tem
`remote-ref` = `refs/heads/<protegida>` (criar, atualizar, forçar ou apagar). Isso cobre
`--all`, `--mirror`, refspecs por glob, `push.default=matching`, `remote.<r>.push` e aliases —
o git já resolveu tudo antes de chamar o hook. Mensagem: §4.5.

### 4.4 Instalação e autorreparo

- `scripts/install-git-hooks.mjs`:
  - fora de um repositório git (ex.: tarball, `npm ci` no Docker), ou quando a raiz do git ≠
    diretório do `package.json` → sai 0 sem fazer nada;
  - a config local fica no `.git/config` compartilhado, então vale para todos os worktrees do
    repositório (intencional); o valor local sobrepõe um `core.hooksPath` global;
  - `core.hooksPath` vazio ou já `.githooks` → grava `.githooks`;
  - outro valor (ex.: husky) → **substitui** por `.githooks` e avisa no stderr que hooks extras
    do projeto devem morar em `.githooks/` (decisão do Claudinho: a trava vale para todos, não
    pode depender de config pré-existente);
  - garante bit executável nos shims; nunca falha o `npm install` por motivo que não seja git
    quebrado.
- SessionStart (novo bloco em `hooks/check-dependencies/run.sh` ou hook irmão — escolha do
  builder): se `core.hooksPath` ≠ `.githooks` ou os shims não são executáveis, **reaplica**
  (mesmo script) e informa no contexto da sessão. Mutação local reversível fora de Prod (`[R1]`).
- `.git/hooks/*` locais deixam de rodar (efeito colateral do `core.hooksPath`) — documentar.

### 4.5 Mensagem

Mesmo prefixo do hook do agente (`BLOCK_PREFIX` de `evaluate.mjs`), seguido do motivo
específico (ex.: "o push para `refs/heads/main` foi recusado pelo hook `pre-push`"). Uma linha
final: "Atualizar a `main` local com `git pull` continua permitido."

## 5. Camada 2 — `hooks/protect-main` (agente)

Novas regras em `evaluate.mjs` (barram sempre, em qualquer branch):

- gravar ou remover `core.hooksPath` (`git config core.hooksPath …`, `--unset`, `set`,
  `--global`/`--system`), salvo gravar exatamente `.githooks`;
- `core.hooksPath` inline: `git -c core.hooksPath=…`, `--config-env=core.hooksPath=…`,
  `GIT_CONFIG_*` com essa chave;
- `git push … --no-verify` (atenção: `git push -n` é `--dry-run` e continua permitido);
- comandos Bash que apagam, movem, truncam, tiram o executável ou sobrescrevem por
  redirecionamento arquivos em `.githooks/` (melhor esforço léxico; editar os hooks pelo
  Edit/Write segue o caminho normal de feature branch + PR).

O ADR-005 deixa de chamar o hook de "a garantia"; ele vira a camada que impede o **agente** de
desligar a camada 1.

## 6. Camada 3 — workflow "Guarda da main"

`.github/workflows/main-guard.yml`, `on: push: branches: [main]` (lista vinda de
`config.json` não é possível em `on:`; o job lê o `config.json` e o gatilho cobre `main` —
derivados que protegerem mais branches atualizam o gatilho; um teste de unit compara os dois).

- `permissions: { contents: read, pull-requests: read, issues: write }`.
- Commits avaliados: os da faixa `before..after` do evento (via API de compare, não
  `event.commits`, que trunca em 20). `before` = zeros (criação da branch, ex.: repositório
  criado a partir do template) → nada a avaliar, sai verde.
- Um commit está ok se `GET /repos/{o}/{r}/commits/{sha}/pulls` retorna um PR com `merged_at`
  preenchido e `base.ref` = a branch. Cobre merge commit, squash e rebase-merge.
- A associação commit→PR pode atrasar logo após o merge: antes de alarmar, até 3 tentativas
  em ~30 s (decisão do Claudinho).
- `forced: true` no evento → sempre alarme (reescrita de histórico da `main`).
- Alarme = job falha com a lista de commits sem PR **e** abre uma issue com o rótulo
  `main-sem-pr` (título com o SHA curto do `after`; se já existe issue aberta com o rótulo,
  comenta nela em vez de abrir outra).
- Lógica em script Node testável (`scripts/main-guard.mjs`, funções puras com a API injetada);
  o YAML só chama o script com `GITHUB_TOKEN`.
- Custo: GitHub Actions em repo privado gratuito tem 2.000 min/mês; o job leva segundos.

Limite honesto: um push direto que **apague ou altere** `main-guard.yml` roda a versão do
próprio commit — o alarme pode não disparar. Documentar no ADR-005.

## 7. Documentação

- `docs/adr/005-trunk-based-development.md`, seção **Aplicação**: três camadas; remover "A
  garantia real" via branch protection do GitHub; branch protection vira opcional ("se o plano
  permitir, ligue também"); limites honestos atualizados (local: desligamento deliberado;
  remoto: detecção, não prevenção; workflow alterado no próprio push).
- `docs/runbooks/bootstrap-ambientes.md` passo 10: branch protection **se disponível**; senão,
  confirmar que o workflow "Guarda da main" está ativo.
- `CLAUDE.md` regra 0: menciona `.githooks/` e a camada 3; "Nunca edite, desative ou contorne"
  passa a incluir `.githooks/` e `core.hooksPath`. Nota de adoção: não remover `.githooks/` nem
  `main-guard.yml`.
- `CONTRIBUTING.md` / `README.md`: `npm install` instala a trava; o que fazer se ela barrar.
- Spec de 2026-10-23: nota no topo de §2 apontando que "Restringir o humano" foi revogado por
  esta spec.

## 8. Testes

- **Unit `git-guard.mjs`** (função pura): tabela dos casos de §4.2 e §4.3, mais branch extra em
  `protectedBranches`.
- **Integração com git real** (repo temporário + remoto bare, `core.hooksPath` apontando para
  `.githooks` do projeto):
  - na `main`: `git commit` → recusado; `git merge feat` → recusado; `git update-ref
    refs/heads/main <x>` → recusado; `git -c alias.x=commit x` → recusado; commit via
    `node -e "execSync('git commit …')"` → recusado;
  - `git pull` (ff) na `main` → permitido; `git reset --hard origin/main` → permitido;
    `git fetch origin main:main` → permitido;
  - commit inicial em `git init` sem remoto → permitido;
  - numa feature branch: commit e push da feature → permitidos; `git push origin HEAD:main`,
    `--all`, `--mirror`, `push.default=matching` → recusados pelo `pre-push`;
  - Node ausente do PATH com linha de branch protegida → recusa.
- **Unit `install-git-hooks.mjs`**: fora de repo, vazio, já `.githooks`, valor alheio.
- **Unit camada 2**: novas linhas BLOCKED/ALLOWED em `protectMainEvaluate.test.ts`
  (`git config core.hooksPath x`, `git -c core.hooksPath=/dev/null commit`,
  `git push --no-verify origin feat/x`, `rm .githooks/pre-push`; permitido: `git push -n origin
  feat/x`, `git config core.hooksPath .githooks`, `git config --get core.hooksPath`).
- **Unit `main-guard.mjs`**: commit com PR mergeado → ok; sem PR → alarme; PR aberto não
  mergeado → alarme; `before` zero → ok; `forced` → alarme; issue existente → comenta.
- **Config**: `package.json` tem o `prepare`; shims existem e são executáveis no git
  (`git ls-files -s` modo `100755`); gatilho do workflow ⊇ `protectedBranches`.

## 9. Critérios de Aceitação

- [ ] Após `npm install` num clone, `git commit` na `main` falha com a mensagem, inclusive via
      `npm run`/`node -e`; `git pull` na `main` funciona.
- [ ] `git push` com destino `main` falha a partir de qualquer branch, inclusive com
      `push.default=matching` e `--mirror`.
- [ ] Uma sessão nova do Claude Code reaplica `core.hooksPath` se alguém o removeu.
- [ ] O agente é barrado ao tentar mexer em `core.hooksPath`, usar `push --no-verify` ou apagar
      `.githooks/`.
- [ ] O workflow "Guarda da main" fica vermelho e abre/comenta a issue `main-sem-pr` para commit
      sem PR mergeado; fica verde para merges de PR.
- [ ] ADR-005, bootstrap passo 10, CLAUDE.md, CONTRIBUTING, README e a nota na spec anterior
      atualizados.
- [ ] `npm run lint`, `npm run type-check`, `npm test`, `npm run check:runbooks` verdes.

## 10. Decisões do Claudinho (para conferência)

- **Alarme sem reversão automática** (check vermelho + issue). A pergunta sobre reverter ficou
  sem resposta explícita; reverter por conta própria poderia desfazer trabalho legítimo, e um
  PR de revert ainda dependeria do merge humano — o alarme entrega a mesma informação sem risco.
- `.githooks/` na raiz, shims `sh` + lógica Node em `hooks/protect-main/git-guard.mjs`.
- Comparação com `origin/<protegida>` (remoto fixo `origin`, padrão do template).
- Commit inicial permitido só enquanto não existe `origin/<protegida>`.
- `core.hooksPath` alheio é substituído, com aviso.
- `git push -n` (dry-run) não é confundido com `--no-verify`.
- Remoto com outro nome (ex.: `upstream`): `origin/main` não existe, então só o commit
  inicial (`old` = zero) passa; atualizar uma `main` existente fica recusado. Seguro;
  documentado.
- Sem matcher novo para Edit/Write: mudanças em `.githooks/` pelo editor seguem feature
  branch + PR.
- Entrega no mesmo branch/PR #14 (`feat/protecao-main-por-pr`), ainda não mergeado e do mesmo
  assunto.
- Tool MCP: não se aplica.

## 11. Decisões do humano

- Feature toggle: **não** — "isso é inegociável".
