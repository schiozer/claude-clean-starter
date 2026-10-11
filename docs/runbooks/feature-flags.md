# Runbook: Feature flags por ambiente

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

## Objetivo

Ligar ou desligar uma flag num ambiente ([ADR-006](../adr/006-processo-de-feature-e-feature-toggle.md)).
Flags são envs **não-secretas** (`on`/`off`):

| Env | Papel |
| --- | --- |
| `<CTX>_ENABLED` | kill switch da feature — desligada, some a página, a rota (`404`) **e as tools MCP** dela |
| `MCP_<CTX>_READ` | tools MCP de leitura (só valem com a feature ligada) |
| `MCP_<CTX>_WRITE` | tools MCP de escrita — nasce **off**; ligar é **sempre R2**, em qualquer ambiente |

No walking skeleton: `RESOURCES_ENABLED`, `MCP_RESOURCES_READ`, `MCP_RESOURCES_WRITE`.

## Pré-condições

- Nome da flag e ambiente-alvo definidos pelo humano (Dev local = `.env.local`, editado pelo humano; UAT = `preview`; Prod = `production`).
- Em Prod, ou para qualquer `MCP_<CTX>_WRITE=on`, o humano está disponível para aprovar (R2).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir o scope Vercel: `vercel project ls --scope <preencher: team Vercel>` lista `<preencher: projeto Vercel>`.
3. [R0] Listar as envs do ambiente (só nomes): `vercel env ls <preview|production> --scope <preencher: team Vercel>`.

## Passos

1. [R1] Trocar a flag no UAT: `vercel env rm <FLAG> preview --yes --scope <preencher: team Vercel>` e `printf 'on' | vercel env add <FLAG> preview --scope <preencher: team Vercel>` (ou `off`). Em Prod (`production`) o passo é **R2**; para `MCP_<CTX>_WRITE=on` é **R2** em qualquer ambiente.
   Verificar: `vercel env ls <preview|production> --scope <preencher: team Vercel>` lista `<FLAG>`.
2. [R1] Redeploy do ambiente para a flag valer: UAT `vercel redeploy <preview-url> --scope <preencher: team Vercel>` e reapontar o alias ([deploy-uat.md](./deploy-uat.md)); Prod `vercel redeploy <deploy-prod-url>` é **R2**.
   Verificar: o novo deploy fica `Ready` em `vercel ls <preencher: projeto Vercel> --scope <preencher: team Vercel>`.
3. [R0] Conferir o efeito: `curl -s -o /dev/null -w '%{http_code}' https://<url-do-ambiente>/api/<ctx>` e `tools/list` no MCP Inspector com um token do ambiente.
   Verificar: feature desligada → `404` e nenhuma tool do módulo; `MCP_<CTX>_WRITE=on` → a tool de escrita aparece só para token com `<ctx>:write`.

## Verificação final

- A flag tem o valor pedido no ambiente pedido, e o comportamento observado bate com a tabela do Objetivo.

## Rollback

1. [R1] Restaurar o valor anterior da flag no UAT (mesmo comando do passo 1) e redeployar; em Prod é **R2**.
   Verificar: `curl` e `tools/list` voltam ao comportamento anterior.

## Registro

Comentário no PR da feature (`gh pr comment <n> --body-file <arquivo>`) ou issue `ops`: flag,
ambiente, valor anterior → novo, aprovação R2 (quando houver), resultado final.
