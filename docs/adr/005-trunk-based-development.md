# 005. Trunk-Based Development (Branching Git)

**Data**: 2026-08-27
**Status**: Aceito

## Contexto

[ADR-002](./002-estrategia-de-ambientes.md) define três ambientes (Dev / UAT /
Prod) e um fluxo de promoção. Falta fixar **a estratégia de branching Git** que
alimenta esse fluxo. A armadilha clássica é criar branches longevas por ambiente
(`develop`, `staging`, `production`): elas divergem, geram merges dolorosos e
fazem "o que está em cada ambiente" virar um mistério.

Forças:

1. **Integração contínua** — quanto mais tempo o código fica fora da trunk, mais
   caro o merge e maior o risco.
2. **Promoção previsível** — o que vai para UAT e Prod deve ser rastreável a um
   commit único da trunk (ADR-002).
3. **Trabalho incompleto** — precisa poder ir para a trunk sem ativar para o
   usuário.

## Decisão

**Trunk-Based Development, sempre. Uma única trunk (`main`), sempre integrável e
deployável. Nada de branches longevas por ambiente.**

- **Todo merge na `main` é via Pull Request — SEMPRE, sem exceção.** Nunca há
  push direto na trunk; qualquer mudança (código, docs, ADRs) passa por PR.
- **Feature branches curtas** (horas a 1–2 dias), com merge frequente na `main`
  **via PR**.
- **CI dirigido por PR**: **abrir/atualizar um PR dispara deploy em UAT**;
  **o merge na `main` (após aprovação do UAT) dispara deploy em Prod**. O ambiente
  é resultado de **onde um commit foi promovido**, não de qual branch ele vive.
  Ver o fluxo em [ADR-002](./002-estrategia-de-ambientes.md).
- **Sem** `develop` / `staging` / `production` como branches de longa duração.
- **Trabalho incompleto fica atrás de feature flags**, não de branch — permite
  integrar cedo sem expor ao usuário.
- A `main` deve passar em type-check, lint e testes antes do merge (ver
  `BEST_PRACTICES.md`).

## Aplicação

A `main` se autogarante em **três camadas**, sem depender da branch protection do GitHub
(que o plano gratuito com repositório privado não oferece). A trava vale para **todos** —
agente e humano. Spec: `docs/superpowers/specs/2026-10-24-main-autogarantida-design.md`.

- **Camada 1 — git hooks versionados (local, todos).** `.githooks/reference-transaction` e
  `.githooks/pre-push` são shims `sh` que delegam a `hooks/protect-main/git-guard.mjs`,
  ativados por `core.hooksPath=.githooks`.
  - `reference-transaction` recusa mudar `refs/heads/main`, exceto: apagar a branch, alinhá-la
    a `origin/main` (`git pull --ff-only`, `git reset --hard origin/main`,
    `git fetch origin main:main`) ou o commit inicial enquanto não existe `origin/main`.
    Barra `commit`, `merge`, `rebase`, `reset`, `branch -f`, `update-ref` etc., venham de onde
    vierem (`npm run`, `make`, `node -e`, scripts) e sem ser pulado por `--no-verify`.
  - `pre-push` recusa qualquer push com destino `refs/heads/main` (inclui `--all`,
    `--mirror`, glob e `push.default=matching`).
  - Fail-closed: sem Node disponível, a operação sobre a `main` é recusada.
  - Instalação: `scripts/install-git-hooks.mjs` pelo `prepare` do npm (todo `npm install`) e
    reaplicação no SessionStart (`hooks/check-dependencies/run.sh`, com aviso
    `protect-main: core.hooksPath reaplicado (.githooks).`). Um `core.hooksPath` alheio
    (ex.: husky) é substituído com aviso: hooks extras do projeto devem morar em `.githooks/`.
    Sem git (ex.: Docker), não faz nada.
- **Camada 2 — hook `hooks/protect-main` (agente).** Guarda léxica de melhor esforço sobre os
  comandos Bash (PreToolUse, regra 0 do `CLAUDE.md`): barra `commit`/`merge`/`rebase` etc.
  na `main`, push para a `main`, `gh pr merge`, `gh api` de merge/ref/conteúdo/proteção,
  aliases e config de push. Para proteger a camada 1, barra também mexer em `core.hooksPath`
  (salvo gravar `.githooks`), `include.path`/`includeIf.*.path`, `--remove-section core`,
  `git push --no-verify` (e abreviações; `-n` é `--dry-run` e continua permitido) e
  apagar, mover, `chmod`, sobrescrever ou redirecionar para `.githooks/` ou `.git/config`.
  Mudar os hooks = Edit/Write numa feature branch + PR. Falha fechado; sem chave de desligar;
  as branches protegidas ficam em `hooks/protect-main/config.json` (fonte única das três
  camadas).
- **Camada 3 — workflow `Guarda da main` (GitHub, detecção).** `.github/workflows/main-guard.yml`
  - `scripts/main-guard.mjs`: em push na `main`, cada commit de `before..after` precisa de um
    PR mergeado com base `main` (`commits/{sha}/pulls`, até 3 tentativas em ~10 s). `forced`,
    branch apagada ou compare truncado (>250 commits) sempre alarmam. Alarme = job vermelho +
    issue com o rótulo `main-sem-pr` (ou comentário na issue aberta). Não reverte nada.
- **Branch protection do GitHub é opcional.** Se o plano permitir (repositório público ou
  plano pago), ligue também (passo 10 de
  [`bootstrap-ambientes`](../runbooks/bootstrap-ambientes.md)): é a garantia mais forte.

### Limites honestos

- **Local**: quem desliga as travas de propósito consegue (`git -c core.hooksPath=`,
  `--no-verify` no push, apagar `.githooks/`, editar `~/.gitconfig`, `rm -rf .git`,
  interpretadores escrevendo arquivos, caminhos em variáveis). Localmente é impossível
  impedir; a camada 3 detecta.
- **Remoto com nome diferente de `origin`**: só o commit inicial passa; atualizar a `main`
  existente fica recusado (lado seguro).
- **`.git/hooks/*` locais deixam de rodar** (efeito do `core.hooksPath`).
- **A camada 3 é detecção, não prevenção.** Um push direto que altere `main-guard.yml`,
  `scripts/main-guard.mjs` ou `hooks/protect-main/config.json` roda a versão do próprio commit
  e pode desarmar o alarme.
- Uma transação `git update-ref --stdin` que também forje `refs/remotes/origin/main` no mesmo
  lote passa localmente (o `pre-push` e a camada 3 ainda barram/detectam).

## Consequências

**Fica mais fácil**

- Merges pequenos e frequentes; menos conflitos e menos "big bang".
- Rastreabilidade: cada ambiente aponta para um commit concreto da trunk.
- Alinhamento direto com o fluxo de promoção do ADR-002.

**Fica mais difícil / dívidas assumidas**

- Exige **feature flags** e disciplina para manter a `main` sempre verde.
- Cobertura de testes automatizados passa a ser pré-requisito, não opcional.
- Mudança cultural para quem vem de GitFlow.

## Alternativas Consideradas

- **GitFlow (branches por ambiente/release)** — descartado: branches longevas
  divergem, os merges doem e contradizem a promoção por commit do ADR-002.
- **GitHub Flow (feature branch → PR → main)** — muito próximo desta decisão; na
  prática esta ADR **é** GitHub Flow reforçado com trunk sempre deployável +
  feature flags. Adotado como forma explícita de trunk-based.
