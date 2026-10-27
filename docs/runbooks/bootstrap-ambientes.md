# Runbook: Bootstrap dos ambientes (Vercel + Neon + Auth0)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

## Objetivo

Criar, **uma vez por projeto**, a infraestrutura dos três estágios (Dev local / UAT / Prod,
[ADR-002](../adr/template/002-estrategia-de-ambientes.md)): projeto Vercel ligado ao repo, banco Neon
com branch por ambiente ([ADR-003](../adr/template/003-banco-por-ambiente-neon.md)), tenants Auth0 por
ambiente ([ADR-004](../adr/template/004-auth-por-ambiente-auth0.md)), envs por ambiente, alias
estável do UAT e proteção da `main`. Quase tudo aqui cria recurso externo → R2.

Entradas (marcadas "preencher") são decididas pelo humano **antes** de executar; saídas
(marcadas "gerado") só existem depois do passo que as cria — não bloqueiam a execução deste
runbook, e o agente as grava aqui e nos demais runbooks via PR ao final.

## Pré-condições

- Repositório no GitHub com o CI do template passando na `main`.
- Humano com acesso de admin ao team Vercel, à organização Neon, aos tenants Auth0 e ao repositório.
- CLIs autenticadas pelo humano: `gh`, `vercel`, `neonctl` (o agente não faz login por ninguém).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir o team Vercel: `vercel teams ls` inclui `<preencher: team Vercel>`.
3. [R0] Conferir a organização Neon: `neonctl projects list --org-id <preencher: org Neon>` responde (sem erro de auth).

## Passos

1. [R2] Criar o projeto Vercel ligado ao repo: `vercel link --project <preencher: projeto Vercel> --scope <preencher: team Vercel>` e conectar o Git no dashboard (Settings → Git).
   Verificar: `vercel project ls --scope <preencher: team Vercel>` lista o projeto e um push numa branch gera preview.
2. [R2] Criar o projeto Neon (a branch `main` dele é **Prod**): `neonctl projects create --name <preencher: projeto Neon> --org-id <preencher: org Neon>`.
   Verificar: `neonctl branches list --project-id <gerado: id do projeto Neon>` mostra `main` (o id vem na saída do `create`).
3. [R2] Criar os branches Neon de UAT e Dev a partir de `main`: `neonctl branches create --name uat --parent main --project-id <gerado: id do projeto Neon>` (idem `dev`).
   Verificar: `neonctl branches list --project-id <gerado: id do projeto Neon>` mostra `main`, `uat` e `dev`.
4. [R2] Ligar o banco aos ambientes **sem** a integração "branch por preview" (o UAT é o branch fixo `uat`, [ADR-003](../adr/template/003-banco-por-ambiente-neon.md)): o `DATABASE_URL` de Preview aponta para o branch `uat` e o de Production para `main`, ambos como **segredo** via [segredos-e-env.md](./segredos-e-env.md) (o humano copia a connection string do console Neon).
   Verificar: `vercel env ls preview` e `vercel env ls production` listam o **nome** `DATABASE_URL`.
5. [R3] Humano: criar os tenants Auth0 de UAT e Prod (`<gerado: domínio do tenant UAT>`, `<gerado: domínio do tenant Prod>`) e os apps de login web; nunca colar client secrets no chat.
   Verificar: o humano confirma os dois domínios de tenant; o agente os anota no runbook via PR.
6. [R1] Criar as envs **não-secretas** do UAT (`APP_ENV=uat`, `MCP_RESOURCE_URL`, flags com padrão off): via [segredos-e-env.md](./segredos-e-env.md) e [feature-flags.md](./feature-flags.md).
   Verificar: `vercel env ls preview --scope <preencher: team Vercel>` lista os nomes.
7. [R2] Criar as envs de Prod e **todos os segredos** (Auth0, tokens) de todos os ambientes via [segredos-e-env.md](./segredos-e-env.md) — o humano digita os valores.
   Verificar: `vercel env ls production --scope <preencher: team Vercel>` lista os nomes esperados.
8. [R1] Criar o alias estável do UAT apontando para um preview `Ready`: `vercel alias set <preview-url> <preencher: alias UAT> --scope <preencher: team Vercel>`.
   Verificar: `vercel alias ls --scope <preencher: team Vercel>` mostra o alias → `<preview-url>`.
9. [R3] Humano: configurar a _Deployment Protection_ da Vercel para o alias do UAT ser acessível no aceite e pelo ChatGPT (exceção para o alias, ou _Protection Bypass_ — ao menos `/api/mcp` e `/.well-known/*`).
   Verificar: `curl -s -o /dev/null -w '%{http_code}' https://<preencher: alias UAT>/` → `200` e `curl -si -X POST https://<preencher: alias UAT>/api/mcp | grep -i '^www-authenticate:.*resource_metadata'` encontra o header do app.
10. [R3] Humano: em Settings → General → Pull Requests, deixar só "Allow squash merging" com "Default to pull request title" (o título do PR vira a mensagem do commit e a fonte da versão, [ADR-014](../adr/template/014-release-management.md)).
    Verificar: `gh api repos/<preencher: owner/repo> --jq '.allow_squash_merge, .allow_merge_commit, .allow_rebase_merge, .squash_merge_commit_title'` → `true false false PR_TITLE`.
11. [R3] Humano: se o plano permitir, ligar a branch protection da `main` (PR obrigatório, sem push direto, required checks `Test & Lint (root)`, `Walking Skeleton (example)` e `PR gate` — e `Spec × código` se `SPEC_GATE=on` — ou os jobs equivalentes do projeto); senão, confirmar que o workflow `Guarda da main` está ativo em Actions.
    Verificar: `gh api repos/<preencher: owner/repo>/branches/main/protection --jq '.required_status_checks.contexts'` lista os checks; sem branch protection, `gh workflow list --repo <preencher: owner/repo>` mostra `Guarda da main` como `active`.

## Verificação final

- Vercel: projeto ligado ao repo; Preview e Production com as envs esperadas (só nomes).
- Neon: `main` (Prod), `uat`, `dev`; `DATABASE_URL` de Preview → `uat`, de Production → `main`.
- Auth0: tenants por ambiente anotados neste runbook.
- GitHub: `main` protegida com os required checks.
- Os `<gerado>` deste runbook e os `<preencher>` dos demais completados com estes valores (PR).
- Alias do UAT acessível sem a Deployment Protection bloquear `/api/mcp`.

## Rollback

1. [R2] Remover o que foi criado nesta execução, do último para o primeiro (destrutivo): `vercel alias rm`, `vercel env rm`, `neonctl branches delete <nome> --project-id <gerado: id do projeto Neon>`, `vercel project rm <preencher: projeto Vercel>` — um por aprovação.
   Verificar: `vercel project ls` e `neonctl branches list` não mostram mais os recursos removidos.

## Registro

Issue com label `ops` (`gh issue create --label ops --title "bootstrap de ambientes" --body-file <arquivo>`):
recursos criados (nomes/IDs, nunca segredos), aprovações R2, passos R3 feitos pelo humano,
resultado final.
