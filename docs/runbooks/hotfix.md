# Runbook: Hotfix (esteira menor — `hotfix/*` direto na `main` e back-promotion)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, Prod

## Objetivo

Corrigir um bug de Prod a partir da `main` (espelho de Prod), sem passar pelo UAT da integração,
e devolver a correção à `develop` pela **back-promotion** — ver
[ADR-021](../adr/template/021-hotfix-e-back-promotion.md). Só vale com o bloco `esteira` ligado;
sem ele, uma correção é um PR comum na `main` ([deploy-uat.md](./deploy-uat.md) →
[deploy-prod.md](./deploy-prod.md)).

Fluxo: `hotfix/*` → PR para `main` (squash) → deploy de Prod direto (sem UAT) → Release → o CI
abre a back-promotion `main` → `develop` (título `chore(release): back-promotion de vX.Y.Z`),
mergeada com **merge commit**. Até a back-promotion ser mergeada e o novo UAT subir, a
**promoção fica bloqueada** ([promover-prod.md](./promover-prod.md)).

**Critério**: correção com "cara de projeto" (regra de negócio, várias partes, migração não
trivial, precisa de aceite) → **não** é hotfix: entra por `develop` (esteira maior, com UAT).

## Pré-condições

- Bug de Prod diagnosticado (`superpowers:systematic-debugging`) e o humano concordou que é hotfix
  pelo critério acima.
- Correção testada em Dev (regressão com teste que falha antes e passa depois).
- Migração, se houver, aditiva e já aplicada em Prod ([migracao-banco.md](./migracao-banco.md)).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Conferir a esteira: `node scripts/esteira/index.mjs ativa` mostra `ativa=true` e `prefixoHotfix` (padrão `hotfix/`).
3. [R0] Conferir a base: `git fetch origin && git status -sb` sem mudanças pendentes.

## Passos

1. [R1] Criar a branch a partir da `main`: `git switch -c hotfix/<descricao> origin/main`, commitar a correção e o teste.
   Verificar: `git merge-base --is-ancestor origin/main HEAD && echo ok` → `ok`; `npm run lint && npm run type-check && npm test` → exit 0.
2. [R1] Publicar e abrir o PR com base `main`: `git push -u origin hotfix/<descricao>` e `gh pr create --base main --fill` (título `fix(<escopo>): …`; template de PR preenchido, seção `## UAT` **desmarcada**).
   Verificar: `gh pr view --json baseRefName,headRefName` → `main` / `hotfix/<descricao>`.
3. [R0] Aguardar os checks e a `Regressão (UAT)` contra o preview do PR: `gh pr checks <n> --watch`.
   Verificar: todos `pass`, exceto o `PR gate`, que espera o passo 4.
4. [R3] Humano: na seção `## UAT` do PR, marcar "UAT não se aplica — hotfix (testado em Dev)" e avisar.
   Verificar: `gh pr checks <n>` mostra `PR gate` `pass`.
5. [R3] Humano: fazer o merge do PR na `main` com **squash** e avisar.
   Verificar: `gh pr view <n> --json state,mergeCommit` → `MERGED`; anotar o `mergeCommit`.
6. [R0] Acompanhar o deploy de Prod do hotfix: `gh run list --workflow deploy.yml --branch main --limit 1` e `gh run watch <run-id>`; depois `gh run list --workflow release.yml --limit 1`.
   Verificar: `Deploy` e `Release` verdes; `gh release view --repo <preencher: owner/repo>` mostra a tag nova no `mergeCommit`. Deploy vermelho → [rollback.md](./rollback.md).
7. [R0] Smoke test em Prod: `curl -s -o /dev/null -w '%{http_code}' https://<preencher: domínio de Prod>/`.
   Verificar: `200` e o bug não se reproduz.
8. [R0] Conferir o PR de back-promotion aberto pelo CI: `gh pr list --base develop --head main --state open --json number,title`.
   Verificar: um PR `chore(release): back-promotion de vX.Y.Z`. Ausente (a Release falhou e **não há aviso**) → passo 9; presente → passo 10.
9. [R1] Só se o CI não abriu: re-rodar a Release que falhou (`gh run rerun <run-id> --failed`), o que cria a tag e dispara a back-promotion; se ela não passar, abrir à mão com a versão do hotfix (o `PR gate` exige o formato `vX.Y.Z` no título): `gh pr create --base develop --head main --title 'chore(release): back-promotion de vX.Y.Z' --body 'Back-promotion do hotfix vX.Y.Z (merge commit).'`.
   Verificar: `gh pr list --base develop --head main --state open` lista o PR.
10. [R1] Só se houver conflito (o CI abre o PR mesmo assim e comenta): `git switch -c backpromotion/vX.Y.Z origin/develop && git merge origin/main`, resolver, commitar o merge e `git push -u origin backpromotion/vX.Y.Z`; abrir o PR com base `develop` a partir dela (merge commit permitido) e fechar o do CI apontando o novo.
    Verificar: `gh pr checks <n> --watch` verde e `git merge-base --is-ancestor origin/main HEAD && echo ok` → `ok`.
11. [R3] Humano: mergear a back-promotion na `develop` com **Create a merge commit** (nunca squash) e avisar.
    Verificar: `git fetch origin && git merge-base --is-ancestor origin/main origin/develop && echo ok` → `ok`.
12. [R0] Aguardar o novo deploy de UAT e a regressão: `gh run list --workflow deploy.yml --branch develop --limit 1` e `gh run watch <run-id>`.
    Verificar: Deployment `uat` novo `success` e check `Regressão (UAT)` (`esteira-uat`) verde no SHA da `develop`; a promoção está desbloqueada.

## Verificação final

- Prod servindo o `mergeCommit` do hotfix, tag `vX.Y.Z` criada, smoke ok.
- Back-promotion mergeada com merge commit; `main` ancestral da `develop`; UAT redeployado.

## Rollback

1. [R2] Se o hotfix piorou Prod: [rollback.md](./rollback.md) (bloco **Rollback** do runbook do host) — pedir aprovação.
   Verificar: o deploy anterior serve Prod e o smoke test passa.
2. [R1] Reverter o hotfix por outro PR `hotfix/revert-<sha>` (`git revert <sha>`), seguindo este runbook do passo 2.
   Verificar: `gh pr checks <n> --watch` verde.

## Registro

Comentário no PR do hotfix (`gh pr comment <n> --body-file <arquivo>`): runbook + `Última verificação`,
motivo de ser hotfix (critério), merge (quem/quando), deploy de Prod, tag, smoke, número do PR de
back-promotion e o merge dele, resultado final (`ok` | `rollback` | `interrompido`).
