# Runbook: Deploy em Prod (merge do PR aprovado no UAT)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Prod

## Objetivo

Promover para Prod um PR já aprovado no UAT. O deploy de Prod é disparado pelo **merge na
`main`** ([ADR-002](../adr/template/002-estrategia-de-ambientes.md)) — e o merge é **sempre do
humano** (R3, [ADR-013](../adr/template/013-governanca-operacional-e-runbooks.md)). O agente prepara,
confere, acompanha o deploy e faz o smoke test. Os passos de host chamam os blocos do runbook do
host do `deploy.config.json` ([host-vercel.md](./host-vercel.md), [host-heroku.md](./host-heroku.md),
[host-cloudrun.md](./host-cloudrun.md)).

## Pré-condições

- PR passou pelo [deploy-uat.md](./deploy-uat.md) e o **humano aprovou o UAT** (registrado no PR).
- Gates verdes (`PR gate`, e `Spec × código` se `SPEC_GATE=on`) e UAT **marcado pelo humano** no PR (o agente nunca o marca).
- Migração aditiva, se houver, **já aplicada em Prod antes do merge** ([ADR-008](../adr/template/008-migracoes-sql-versionadas-driver-http.md), [migracao-banco.md](./migracao-banco.md)).
- Envs/flags de Prod já configuradas; features novas entram **desligadas** em Prod ([ADR-006](../adr/template/006-processo-de-feature-e-feature-toggle.md)).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Conferir a conta e o projeto do host: Pre-flight do runbook do host (host-<host>.md).
3. [R0] Anotar o deploy de Prod atual (alvo do rollback): bloco **Prod** do runbook do host (host-<host>.md), passo de anotar o deploy atual.

## Passos

1. [R0] Conferir que o PR está verde e atualizado: `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup`.
   Verificar: `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN` e todos os checks `SUCCESS`.
2. [R0] Conferir a aprovação do UAT: `gh pr view <n> --comments`.
   Verificar: há aprovação explícita do humano para o UAT deste PR (sem ela → parar).
3. [R3] Humano: fazer o merge do PR na `main` (`gh pr merge <n>` ou botão no GitHub) e avisar quando terminar.
   Verificar: `gh pr view <n> --json state,mergeCommit` → `state: MERGED`; anotar o `mergeCommit`.
4. [R0] Acompanhar o deploy de Produção: bloco **Prod** do runbook do host (host-<host>.md), passo de acompanhar.
   Verificar: o deploy do `mergeCommit` fica pronto (falhou → [rollback.md](./rollback.md)).
5. [R0] Conferir que o domínio de Prod serve **esse** deploy. Na Vercel: passo de conferir o domínio do bloco **Prod** do host-vercel.md. Nos demais hosts não há passo próprio: no Heroku, a release de topo do `-prod` (passo de acompanhar) é a do `mergeCommit`; no Cloud Run, a revisão com 100% do tráfego (passo de anotar o deploy atual) é a do `mergeCommit`.
   Verificar: o deploy servido é o do `mergeCommit`. Se é outro: na Vercel (rollback instantâneo ativo) → passo 6; no Heroku e no Cloud Run, é falha → [rollback.md](./rollback.md). Senão, pular o passo 6.
6. [R2] Só na Vercel e só se o domínio não serve o deploy do merge: passo de promover do bloco **Prod** do host-vercel.md (`promote`, que religa a atribuição automática do domínio). Nos demais hosts: não se aplica (o deploy do merge já recebe o tráfego).
   Verificar: o domínio de Prod serve o deploy do `mergeCommit`.
7. [R0] Smoke test em Prod: `curl -s -o /dev/null -w '%{http_code}' https://<preencher: domínio de Prod>/` e `curl -si -X POST https://<preencher: domínio de Prod>/api/mcp | grep -i '^www-authenticate:.*resource_metadata'`.
   Verificar: `200` na home e `/api/mcp` sem token → `401` com `WWW-Authenticate` contendo `resource_metadata`.
8. [R0] Observar erros por alguns minutos: bloco **Prod** do runbook do host, passo de logs.
   Verificar: sem pico de erros 5xx novos (havendo → [rollback.md](./rollback.md)).

## Verificação final

- Domínio de Prod servindo o deploy do commit do merge; smoke test ok; logs sem erros novos.
- Humano avisado do resultado.

## Rollback

1. [R2] Seguir o [rollback.md](./rollback.md) — primeiro desligar a flag da feature; se não bastar, voltar ao deploy anotado no pre-flight pelo bloco **Rollback** do runbook do host (host-<host>.md).
   Verificar: os `Verificar:` do bloco mostram o deploy anterior servindo Prod e o smoke test volta a passar.

## Registro

Comentário no PR mergeado (`gh pr comment <n> --body-file <arquivo>`): runbook +
`Última verificação`, merge feito pelo humano (quem/quando), deploy de Prod, smoke test,
tag `vX.Y.Z` gerada pelo workflow de release (`gh release view --repo <preencher: owner/repo>`), resultado final (`ok` | `rollback` | `interrompido`).
