# Guia: MCP — conectar ChatGPT, Claude e Cursor ao seu sistema

> Decisão em [ADR-012](../adr/012-mcp-como-borda-agentica.md). Este guia é o passo a passo
> operacional. Nomes de menus de terceiros (ChatGPT, Auth0) mudam com frequência — se algo
> não bater, confira a documentação atual do fornecedor.

## Visão geral

```
Cliente MCP (ChatGPT) ──HTTPS──► https://<ambiente>/api/mcp
   │ 1. sem token → 401 + WWW-Authenticate (resource_metadata)
   │ 2. lê /.well-known/oauth-protected-resource → Auth0 do ambiente
   │ 3. registro dinâmico de cliente + login do usuário no Auth0
   └ 4. chama tools com Authorization: Bearer <jwt>
```

Cada ambiente tem seu endpoint e seu tenant Auth0 (ADR-004): conecte o ChatGPT ao **UAT**
para testar e ao **Prod** só depois do merge.

## 1. Configurar o Auth0 (por ambiente)

1. **API (resource server)**: Applications → APIs → *Create API*.
   - *Identifier* (audience) = **URL exata do MCP do ambiente**, ex.:
     `https://<projeto>-uat.vercel.app/api/mcp`. O `Auth0JwtVerifier` rejeita tokens com
     outro `aud`.
   - *Permissions*: crie os escopos de cada módulo exposto, ex.: `resources:read`,
     `resources:write`.
2. **Registro dinâmico de cliente**: em Settings → Advanced, habilite o *Dynamic
   Client Registration* (registro OIDC dinâmico). O ChatGPT usa isso para se registrar
   sozinho.
3. **Conexões**: a conexão de login (ex.: Username-Password ou Google) precisa estar
   disponível para apps registrados dinamicamente (conexão de domínio/"domain level").
4. **Indicador de recurso**: a spec do MCP pede o parâmetro `resource` (RFC 8707). Confira
   se o tenant aceita `resource` ou se exige `audience`; ajuste o metadado em
   `/.well-known/oauth-protected-resource` conforme.
5. Variáveis do app (por ambiente, nunca commitadas):
   `AUTH0_ISSUER_BASE_URL`, `MCP_RESOURCE_URL` (= audience).

## 2. Ligar as tools

As tools ficam atrás de flags (ADR-006):

| Flag | Padrão | Efeito |
|---|---|---|
| `mcp.<ctx>.read` | ligada | tools de leitura do módulo aparecem |
| `mcp.<ctx>.write` | **desligada** | tools de escrita aparecem (se o token tiver `<ctx>:write`) |

Ligue a escrita **por ambiente**, conscientemente — comece pelo UAT.

## 3. Conectar o ChatGPT

1. Ative o **modo desenvolvedor** nas configurações do ChatGPT (área de Apps/Connectors,
   opções avançadas). Requer um plano que suporte connectors customizados.
2. Crie um connector/app com a URL `https://<projeto>-uat.vercel.app/api/mcp` e
   autenticação **OAuth**.
3. O ChatGPT abre o login do Auth0 do UAT → entre com um usuário de teste → consinta os
   escopos.
4. Num chat novo, habilite o connector e pergunte: *"quais são meus recursos?"*.
5. Esperado: a resposta lista **só** os recursos daquele usuário. Tools de escrita só
   aparecem com a flag de escrita ligada e o escopo concedido; o ChatGPT pede confirmação
   antes de executá-las.

## 4. Conectar Claude / Cursor

- **Claude (desktop/web)**: adicione um *custom connector* com a mesma URL; o fluxo OAuth é
  o mesmo.
- **Cursor / scripts**: use um **token pessoal** no header:

```json
{
  "mcpServers": {
    "meu-sistema-uat": {
      "url": "https://<projeto>-uat.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer pat_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

## 5. Tokens pessoais (PAT)

- Gerados pelo próprio usuário no sistema, com **escopos** e **expiração**; exibidos uma
  única vez.
- Guardados só como hash SHA-256; podem ser revogados a qualquer momento.
- Nunca compartilhe nem commite um PAT. Trate-o como senha.

## 6. Testar localmente

- Rode o app (`npm run dev`) e use o **MCP Inspector**
  (`npx @modelcontextprotocol/inspector`) apontando para `http://localhost:3000/api/mcp`.
- No Dev local, o verificador aceita um PAT de desenvolvimento (definido no seed) — não há
  OAuth real.

## Troubleshooting

| Sintoma | Causa provável |
|---|---|
| `401` mesmo após login | `aud` do token ≠ `MCP_RESOURCE_URL` (audience da API errada) |
| ChatGPT não consegue se registrar | Registro dinâmico de cliente desabilitado no tenant |
| Tool não aparece | Flag desligada ou escopo ausente no token |
| `isError` com "tente novamente" | Erro técnico — veja os logs do ambiente |
