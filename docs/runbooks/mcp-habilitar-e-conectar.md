# Runbook: Habilitar o MCP e conectar o ChatGPT

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT, Prod

## Objetivo

Configurar o Auth0 do ambiente para o servidor MCP (`/api/mcp`,
[ADR-012](../adr/012-mcp-como-borda-agentica.md)), definir as envs, verificar o endpoint e
conectar o ChatGPT com usuários de teste. Detalhes de cada tela em
[mcp-guide.md](../guides/mcp-guide.md). Comece pelo **UAT**; Prod só depois do merge.

## Pré-condições

- Ambientes criados ([bootstrap-ambientes.md](./bootstrap-ambientes.md)) e alias estável do UAT ativo (o `aud` precisa da URL exata).
- `MCP_RESOURCE_URL` do ambiente definida: `https://<preencher: alias UAT>/api/mcp` (UAT) / `https://<preencher: domínio de Prod>/api/mcp` (Prod).
- Dois usuários de teste no tenant do ambiente.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir o scope Vercel: `vercel project ls --scope <preencher: team Vercel>` lista `<preencher: projeto Vercel>`.
3. [R0] Conferir o tenant Auth0 do ambiente: o humano confirma que está logado em `<preencher: tenant UAT>` (UAT) ou `<preencher: tenant Prod>` (Prod) — nunca o de outro ambiente.

## Passos

1. [R2] Criar a API no Auth0 com _Identifier_ = `MCP_RESOURCE_URL` exata, permissions `<ctx>:read`/`<ctx>:write`, **Enable RBAC** + **Add Permissions in the Access Token**, e roles com as permissões para os usuários de teste (dashboard pelo humano, ou Auth0 CLI pelo agente após aprovação).
   Verificar: na API, _Settings_ mostra o identifier igual a `MCP_RESOURCE_URL` e RBAC ligado; os usuários de teste têm a role.
2. [R2] Habilitar o _Dynamic Client Registration_ no tenant, com consentimento obrigatório; conexões de login disponíveis em nível de domínio; `resource` tratado como `audience` (ver [mcp-guide.md](../guides/mcp-guide.md) §1). Em Prod, registrar a justificativa (ou pré-registrar clientes em vez de DCR).
   Verificar: _Tenant Settings → Advanced_ mostra DCR ligado e a tela de consentimento não está desabilitada.
3. [R1] Definir as envs do UAT `AUTH0_ISSUER_BASE_URL` (`https://<preencher: tenant UAT>/`) e `MCP_RESOURCE_URL` via [segredos-e-env.md](./segredos-e-env.md) (não-secretas); em Prod é **R2**.
   Verificar: `vercel env ls preview --scope <preencher: team Vercel>` lista os dois nomes.
4. [R1] Redeploy do UAT e reapontar o alias ([deploy-uat.md](./deploy-uat.md)); em Prod é **R2**.
   Verificar: o novo deploy fica `Ready` atrás do alias.
5. [R0] Conferir o metadata OAuth: `curl -s https://<preencher: alias UAT>/.well-known/oauth-protected-resource`.
   Verificar: `resource` = `MCP_RESOURCE_URL` e `authorization_servers` aponta para o tenant **do ambiente**.
6. [R0] Conferir o fail-closed: `curl -si -X POST https://<preencher: alias UAT>/api/mcp`.
   Verificar: `401` com header `WWW-Authenticate` contendo `resource_metadata`.
7. [R2] Ligar a escrita MCP (`MCP_<CTX>_WRITE=on`) só se a demonstração exigir, via [feature-flags.md](./feature-flags.md).
   Verificar: com token de `<ctx>:write`, `tools/list` mostra a tool de escrita; sem o escopo, não.
8. [R3] Humano: conectar o ChatGPT (modo desenvolvedor → connector com a URL do MCP e OAuth) e fazer login com o usuário de teste 1; repetir com o usuário 2 numa conta/sessão separada. O agente não faz login por ninguém.
   Verificar: o humano confirma que "quais são meus recursos?" lista só os do usuário logado e que um não vê os recursos criados pelo outro.

## Verificação final

- Metadata OAuth e `401` corretos no ambiente; ChatGPT conectado com dois usuários e isolamento confirmado; escrita MCP só ligada se aprovada.

## Rollback

1. [R2] Desligar a escrita MCP (`MCP_<CTX>_WRITE=off`) e/ou a feature (`<CTX>_ENABLED=off`) via [feature-flags.md](./feature-flags.md).
   Verificar: `tools/list` não mostra mais as tools afetadas.
2. [R2] Desligar o DCR no tenant e remover os clientes registrados dinamicamente que não devem existir (dashboard).
   Verificar: _Applications_ não lista os clientes removidos e um novo registro é recusado.

## Registro

Comentário no PR relacionado ou issue `ops`: ambiente, tenant, identifier da API, envs
(nomes), estado do DCR e da escrita MCP, aprovações R2, passos R3 confirmados pelo humano,
resultado final. Nunca tokens ou client secrets.
