# Runbook: Feature flags por ambiente

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

## Objetivo

Ligar ou desligar uma flag num ambiente ([ADR-006](../adr/template/006-processo-de-feature-e-feature-toggle.md)).
Flags são envs **não-secretas** (`on`/`off`):

| Env               | Papel                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `<CTX>_ENABLED`   | kill switch da feature — desligada, some a página, a rota (`404`) **e as tools MCP** dela |
| `MCP_<CTX>_READ`  | tools MCP de leitura (só valem com a feature ligada)                                      |
| `MCP_<CTX>_WRITE` | tools MCP de escrita — nasce **off**; ligar é **sempre R2**, em qualquer ambiente         |

No walking skeleton: `RESOURCES_ENABLED`, `MCP_RESOURCES_READ`, `MCP_RESOURCES_WRITE`.

## Pré-condições

- Nome da flag e ambiente-alvo definidos pelo humano (Dev local = `.env.local`, editado pelo humano; UAT e Prod = envs do host, bloco **Segredos e envs** de [host-vercel.md](./host-vercel.md), [host-heroku.md](./host-heroku.md) ou [host-cloudrun.md](./host-cloudrun.md)).
- Em Prod, ou para qualquer `MCP_<CTX>_WRITE=on`, o humano está disponível para aprovar (R2).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir a conta e o projeto do host: Pre-flight do runbook do host do `deploy.config.json` (host-<host>.md).
3. [R0] Listar as envs do ambiente (só nomes): bloco **Segredos e envs** do runbook do host, passo de listar.

## Passos

1. [R1] Trocar a flag no UAT (`on`/`off`): passo de env não-secreta do bloco **Segredos e envs** do runbook do host. Em Prod o passo é **R2**; para `MCP_<CTX>_WRITE=on` é **R2** em qualquer ambiente; no Heroku e no Cloud Run, toda mudança de env é **R2** (cria release/revisão).
   Verificar: a listagem de nomes do bloco mostra `<FLAG>` no ambiente.
2. [R1] Fazer a flag valer: passo 3 do [segredos-e-env.md](./segredos-e-env.md) (na Vercel, redeploy e reapontar o UAT fixo; no Heroku, a mudança já criou a release; no Cloud Run, push no PR e reapontar a tag `uat`); em Prod na Vercel, o redeploy é **R2**.
   Verificar: o deploy/release/revisão nova do ambiente fica pronta (bloco **Prod** ou **UAT** do runbook do host).
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
