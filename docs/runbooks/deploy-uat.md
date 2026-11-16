# Runbook: Deploy em UAT (PR → preview)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT

## Objetivo

Levar uma feature branch ao UAT: abrir/atualizar o PR, que dispara o preview deployment
([ADR-002](../adr/template/002-estrategia-de-ambientes.md)), apontar o UAT fixo para ele e
fazer o smoke test. Os passos de host chamam os blocos do runbook do host do `deploy.config.json`
([host-vercel.md](./host-vercel.md), [host-heroku.md](./host-heroku.md),
[host-cloudrun.md](./host-cloudrun.md)); `<URL do UAT>` é a que o bloco **UAT** dele indica. **Não faz merge** — Prod é o [deploy-prod.md](./deploy-prod.md).

## Pré-condições

- `bootstrap-ambientes.md` já executado (antes disso não há UAT a operar: push + PR seguem só as regras 5 e 8 do `CLAUDE.md`).
- Trabalho commitado numa feature branch curta (`tipo/descricao`, [ADR-005](../adr/template/005-trunk-based-development.md)), nunca na `main`.
- Migração aditiva, se houver, já aplicada no branch Neon de UAT ([migracao-banco.md](./migracao-banco.md)).
- Envs/flags necessárias já existem no UAT do host ([segredos-e-env.md](./segredos-e-env.md), [feature-flags.md](./feature-flags.md)).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`; divergiu → parar e pedir ao humano a troca de conta).
2. [R0] Conferir a conta e o projeto do host: Pre-flight do runbook do host (host-<host>.md).
3. [R0] Conferir a branch: `git branch --show-current` ≠ `main` e `git status --porcelain` vazio.

## Passos

1. [R0] Rodar as checagens locais: `npm run lint && npm run type-check && npm test`.
   Verificar: exit 0 (falhou → parar; não é caso de rollback, nada mudou).
2. [R1] Publicar a branch: `git push -u origin <branch>` (nunca `--force` em branch compartilhada — R3).
   Verificar: `git status -sb` mostra a branch sincronizada com `origin/<branch>`.
3. [R1] Abrir o PR contra a `main` (ou reaproveitar o existente): `gh pr create --base main --fill` / `gh pr view <branch>`.
   Verificar: `gh pr view <branch> --json url,state` → `state: OPEN`.
4. [R0] Aguardar o CI: `gh pr checks <n> --watch`.
   Verificar: todos os checks `pass` (falhou → corrigir na branch e voltar ao passo 1).
5. [R0] Localizar o preview do PR: bloco **UAT** do runbook do host (host-<host>.md), passo de localizar o preview.
   Verificar: o preview do SHA do PR está pronto; anotar a `<preview-url>` (ou revisão/slug, conforme o host).
6. [R1] Apontar o UAT fixo para o preview: bloco **UAT** do runbook do host (host-<host>.md).
   Verificar: os `Verificar:` do bloco passam (o UAT fixo aponta para o preview do PR).
7. [R0] Smoke test no UAT: `curl -s -o /dev/null -w '%{http_code}' https://<URL do UAT>/` e `curl -si -X POST https://<URL do UAT>/api/mcp | grep -i '^www-authenticate:.*resource_metadata'`.
   Verificar: `200` na home e o header `WWW-Authenticate` com `resource_metadata` (é o 401 **do app**, fail-closed). Na Vercel, um 401 sem esse header vem da _Deployment Protection_ → a exceção do alias UAT não está configurada (Bootstrap do host-vercel.md); parar.
8. [R0] Aguardar a regressão no Preview do PR: `gh pr checks <n> --watch` até `Regressão (UAT)` ficar `pass` ([ADR-016](../adr/template/016-testes-e2e-nascidos-da-spec.md); alvo preview configurado por [e2e-uat-configurar.md](./e2e-uat-configurar.md)).
   Verificar: `gh pr checks <n>` mostra `Regressão (UAT)` `pass`. Vermelho (inclusive `flaky`, deploy com erro ou timeout do Preview) → corrigir na branch e voltar ao passo 1; **nunca** liberar o UAT ao humano com a regressão vermelha.

## Verificação final

- PR aberto e verde, incluindo `Regressão (UAT)`; UAT fixo apontando para o preview do PR; smoke test ok (home `200`, `/api/mcp` com `WWW-Authenticate` do app).
- URL do UAT informada ao humano para o teste de aceite (site/celular).

## Rollback

1. [R1] Reapontar o UAT fixo para o preview anterior: bloco **UAT** do runbook do host (host-<host>.md), passo de reverter.
   Verificar: os `Verificar:` do bloco passam e a home do UAT responde `200`.
2. [R1] Se o PR não deve seguir, convertê-lo em draft: `gh pr ready <n> --undo`.
   Verificar: `gh pr view <n> --json isDraft` → `true`.

## Registro

Comentário no PR (`gh pr comment <n> --body-file <arquivo>`): runbook + `Última verificação`,
preview e UAT fixo, resultado dos checks (incl. `Regressão (UAT)`) e do smoke test, resultado final (`ok` | `rollback` |
`interrompido`).
