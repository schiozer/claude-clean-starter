# 012. MCP como borda agêntica (adaptador irmão do REST)

**Data**: 2026-10-10
**Status**: Aceito

## Contexto

Queremos que LLMs — em especial o **ChatGPT** (connectors / modo desenvolvedor), além de
Claude e Cursor — consultem e operem nossos sistemas **em nome do usuário logado**. O
protocolo padrão para isso é o **Model Context Protocol (MCP)**: o sistema expõe *tools*
via HTTP e o cliente as descobre e chama. O ChatGPT conecta-se a servidores MCP remotos
autenticados por **OAuth**.

Restrições: app serverless na Vercel ([ADR-001](./001-neon-auth0.md)), Auth0 por ambiente
([ADR-004](./004-auth-por-ambiente-auth0.md)), toggles por feature
([ADR-006](./006-processo-de-feature-e-feature-toggle.md)), erros funcional vs técnico
([ADR-009](./009-erros-funcional-vs-tecnico.md)), rate limit em Postgres
([ADR-010](./010-rate-limit-em-tabela-postgres.md)) e o service como porta única
([ADR-011](./011-service-layer-ddd-modular-e-perfis.md)).

## Decisão

1. **MCP é um adaptador em `interfaces/mcp/` de cada módulo**, irmão do REST, que chama o
   mesmo `<Ctx>Service`. Nenhuma regra de negócio ou autorização vive na tool.

2. **Declaração de tools** com `defineTool` (`src/shared/mcp/`):

   ```ts
   defineTool({
     name: 'list_resources',                 // verbo_substantivo, snake_case
     description: 'Lista os recursos do usuário. Use para responder "quais são meus recursos".',
     input: listResourcesSchema,             // mesmo Zod do REST
     scope: 'resources:read',                // obrigatório
     annotations: { readOnlyHint: true },
     flag: 'mcp.resources.read',
     handler: (actor, input) => services.resource.list(actor, input),
   })
   ```

   Tools de escrita usam `readOnlyHint: false` (e `destructiveHint` quando apaga/sobrescreve)
   e nascem com a flag **desligada por padrão**.

3. **Servidor único** em `app/api/mcp/route.ts`, com o SDK oficial
   `@modelcontextprotocol/sdk`, transporte **Streamable HTTP stateless**. O registry agrega
   as tools de todos os módulos e **lista só** as que têm flag ligada **e** escopo presente
   no token; o service revalida o escopo (defesa em profundidade).

4. **Autenticação — o MCP é um OAuth Resource Server:**
   - `GET /.well-known/oauth-protected-resource` publica o metadado (RFC 9728) apontando o
     **tenant Auth0 do ambiente** como authorization server.
   - Sem token / token inválido → HTTP `401` com
     `WWW-Authenticate: Bearer resource_metadata="<url do metadado>"`.
   - `IAccessTokenVerifier` com dois adaptadores, ambos produzindo `AuthUser`:
     - `Auth0JwtVerifier` — JWKS, `iss`, **`aud` = URL do MCP do ambiente**, `exp`, escopos.
     - `PersonalTokenVerifier` — tokens `pat_<random>` guardados **só como hash SHA-256**,
       com escopos, `expiresAt`, `revokedAt`, `lastUsedAt`.
   - Escolha do verificador pelo formato (`pat_` → PAT; senão → JWT).
   - Fora do Dev local, só HTTPS.

5. **Escopos** `<ctx>:read` / `<ctx>:write` vêm do token (OAuth ou PAT) e da sessão web
   (escopos do papel do usuário). Tenant/owner **sempre** derivados do `actor`, nunca do
   input da LLM.

6. **Erros:** falha de autenticação → HTTP `401`. Demais erros → resultado MCP com
   `isError: true`; funcionais com mensagem acionável para a LLM, técnicos com mensagem
   genérica sem detalhes internos (ADR-009).

7. **Operação:** rate limit por ator (ADR-010) e log de auditoria de toda tool de escrita
   (ator, tool, horário, resultado; sem payload sensível). Cada ambiente (UAT/Prod) tem seu
   próprio endpoint MCP e seu próprio tenant Auth0.

## Consequências

- ➕ Todo sistema do template fica acessível a qualquer cliente MCP com o mesmo endpoint.
- ➕ A LLM enxerga só o que o usuário enxergaria; sem caminho que pule guards.
- ➕ Nada de infraestrutura nova: mesma função serverless, mesmo pipeline PR → UAT → Prod.
- ➖ Configuração extra no Auth0 (API com audience = URL do MCP, registro dinâmico de
  cliente, escopos) por ambiente — ver [docs/guides/mcp-guide.md](../guides/mcp-guide.md).
- ➖ Descrições de tools viram "UX para LLM" e precisam de revisão como copy.
- ➖ Sem sessão MCP (stateless): sem notificações server→client. Aceito.

## Alternativas Consideradas

- **MCP como deployable separado (`apps/mcp`)**: isolamento e escala próprios, mas dobra
  projetos, ambientes e segredos. Reavaliar quando o tráfego MCP divergir do web.
- **Gerar MCP a partir da API REST/OpenAPI**: tools "com cara de endpoint", descrições
  ruins para LLM, payloads grandes, salto HTTP extra, sem anotações confiáveis. Descartada.
- **Só token pessoal (sem OAuth)**: simples, mas o ChatGPT trabalha com OAuth para
  connectors autenticados. Mantido apenas como alternativa.
