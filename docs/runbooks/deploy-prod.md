# Runbook: Deploy em Prod (merge do PR aprovado no UAT)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Prod

## Objetivo

Promover para Prod um PR já aprovado no UAT. O deploy de Prod é disparado pelo **merge na
`main`** ([ADR-002](../adr/002-estrategia-de-ambientes.md)) — e o merge é **sempre do
humano** (R3, [ADR-013](../adr/013-governanca-operacional-e-runbooks.md)). O agente prepara,
confere, acompanha o deploy e faz o smoke test.

## Pré-condições

- PR passou pelo [deploy-uat.md](./deploy-uat.md) e o **humano aprovou o UAT** (registrado no PR).
- Gates verdes (`PR gate`, e `Spec × código` se `SPEC_GATE=on`) e UAT **marcado pelo humano** no PR (o agente nunca o marca).
- Migração aditiva, se houver, **já aplicada em Prod antes do merge** ([ADR-008](../adr/008-migracoes-sql-versionadas-driver-http.md), [migracao-banco.md](./migracao-banco.md)).
- Envs/flags de Prod já configuradas; features novas entram **desligadas** em Prod ([ADR-006](../adr/006-processo-de-feature-e-feature-toggle.md)).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Conferir o scope Vercel: `vercel project ls --scope <preencher: team Vercel>` lista `<preencher: projeto Vercel>`.
3. [R0] Anotar o deploy de Prod atual (alvo do rollback): `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>`.

## Passos

1. [R0] Conferir que o PR está verde e atualizado: `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup`.
   Verificar: `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN` e todos os checks `SUCCESS`.
2. [R0] Conferir a aprovação do UAT: `gh pr view <n> --comments`.
   Verificar: há aprovação explícita do humano para o UAT deste PR (sem ela → parar).
3. [R3] Humano: fazer o merge do PR na `main` (`gh pr merge <n>` ou botão no GitHub) e avisar quando terminar.
   Verificar: `gh pr view <n> --json state,mergeCommit` → `state: MERGED`; anotar o `mergeCommit`.
4. [R0] Acompanhar o deploy de Produção: `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>`.
   Verificar: o deploy do `mergeCommit` chega a `Ready` (`Error` → [rollback.md](./rollback.md)).
5. [R0] Conferir que o domínio de Prod serve **esse** deploy: `vercel inspect https://<preencher: domínio de Prod> --scope <preencher: team Vercel>`.
   Verificar: o deploy servido é o do `mergeCommit`. Se é outro, há um rollback instantâneo ativo (a atribuição automática do domínio fica desligada) → passo 6; senão, pular o passo 6.
6. [R2] Só com rollback ativo: promover o novo deploy, religando a atribuição automática: `vercel promote <deploy-do-mergeCommit> --scope <preencher: team Vercel>`.
   Verificar: `vercel inspect https://<preencher: domínio de Prod>` mostra o deploy do `mergeCommit`.
7. [R0] Smoke test em Prod: `curl -s -o /dev/null -w '%{http_code}' https://<preencher: domínio de Prod>/` e `curl -si -X POST https://<preencher: domínio de Prod>/api/mcp | grep -i '^www-authenticate:.*resource_metadata'`.
   Verificar: `200` na home e `/api/mcp` sem token → `401` com `WWW-Authenticate` contendo `resource_metadata`.
8. [R0] Observar erros por alguns minutos: `vercel logs <deploy-url> --scope <preencher: team Vercel>`.
   Verificar: sem pico de erros 5xx novos (havendo → [rollback.md](./rollback.md)).

## Verificação final

- Domínio de Prod servindo o deploy do commit do merge; smoke test ok; logs sem erros novos.
- Humano avisado do resultado.

## Rollback

1. [R2] Seguir o [rollback.md](./rollback.md) — primeiro desligar a flag da feature; se não bastar, promover o deploy anotado no pre-flight: `vercel rollback <deploy-anterior> --scope <preencher: team Vercel>`.
   Verificar: `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>` mostra o deploy anterior servindo Prod e o smoke test volta a passar.

## Registro

Comentário no PR mergeado (`gh pr comment <n> --body-file <arquivo>`): runbook +
`Última verificação`, merge feito pelo humano (quem/quando), deploy de Prod, smoke test,
tag `vX.Y.Z` gerada pelo workflow de release (`gh release view --repo <preencher: owner/repo>`), resultado final (`ok` | `rollback` | `interrompido`).
