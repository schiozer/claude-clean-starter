# Runbook: Deploy em UAT (PR → preview)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT

## Objetivo

Levar uma feature branch ao UAT: abrir/atualizar o PR, que dispara o preview deployment
([ADR-002](../adr/002-estrategia-de-ambientes.md)), apontar o alias estável do UAT para ele e
fazer o smoke test. **Não faz merge** — Prod é o [deploy-prod.md](./deploy-prod.md).

## Pré-condições

- `bootstrap-ambientes.md` já executado (antes disso não há UAT a operar: push + PR seguem só as regras 5 e 8 do `CLAUDE.md`).
- Trabalho commitado numa feature branch curta (`tipo/descricao`, [ADR-005](../adr/005-trunk-based-development.md)), nunca na `main`.
- Migração aditiva, se houver, já aplicada no branch Neon de preview/UAT ([migracao-banco.md](./migracao-banco.md)).
- Envs/flags necessárias já existem no ambiente Preview ([segredos-e-env.md](./segredos-e-env.md), [feature-flags.md](./feature-flags.md)).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`; divergiu → parar e pedir ao humano a troca de conta).
2. [R0] Conferir o scope Vercel: `vercel project ls --scope <preencher: team Vercel>` lista `<preencher: projeto Vercel>`.
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
5. [R0] Localizar o preview do PR: `vercel ls <preencher: projeto Vercel> --scope <preencher: team Vercel>` (ou o comentário do bot da Vercel no PR).
   Verificar: o deploy mais recente da branch está `Ready`; anotar a `<preview-url>`.
6. [R1] Apontar o alias estável do UAT para o preview: `vercel alias set <preview-url> <preencher: alias UAT, ex. projeto-uat.vercel.app> --scope <preencher: team Vercel>`.
   Verificar: `vercel alias ls --scope <preencher: team Vercel>` mostra o alias → `<preview-url>`.
7. [R0] Smoke test no alias: `curl -s -o /dev/null -w '%{http_code}' https://<preencher: alias UAT>/` e `curl -si -X POST https://<preencher: alias UAT>/api/mcp | grep -i '^www-authenticate:.*resource_metadata'`.
   Verificar: `200` na home e o header `WWW-Authenticate` com `resource_metadata` (é o 401 **do app**, fail-closed). Um 401 sem esse header vem da _Deployment Protection_ da Vercel → a exceção do alias UAT não está configurada ([bootstrap-ambientes.md](./bootstrap-ambientes.md)); parar.

## Verificação final

- PR aberto e verde; alias do UAT apontando para o preview do PR; smoke test ok (home `200`, `/api/mcp` com `WWW-Authenticate` do app).
- URL do UAT informada ao humano para o teste de aceite (site/celular).

## Rollback

1. [R1] Reapontar o alias do UAT para o preview anterior: `vercel alias set <preview-anterior> <preencher: alias UAT> --scope <preencher: team Vercel>`.
   Verificar: `vercel alias ls --scope <preencher: team Vercel>` mostra o alias → `<preview-anterior>` e a home responde `200`.
2. [R1] Se o PR não deve seguir, convertê-lo em draft: `gh pr ready <n> --undo`.
   Verificar: `gh pr view <n> --json isDraft` → `true`.

## Registro

Comentário no PR (`gh pr comment <n> --body-file <arquivo>`): runbook + `Última verificação`,
preview e alias, resultado dos checks e do smoke test, resultado final (`ok` | `rollback` |
`interrompido`).
