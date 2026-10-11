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

> **UAT precisa de URL estável.** Previews por PR mudam de URL, e o `aud` do token precisa conter
> a URL exata do MCP. Use um alias/domínio fixo para o UAT (ex.: `<projeto>-uat.vercel.app`,
> apontado para o preview do PR em teste) e configure audience e `MCP_RESOURCE_URL` com ele.
> Se os previews têm _Deployment Protection_, libere `/api/mcp` e `/.well-known/*` nesse
> alias (bypass ou domínio próprio) — senão o ChatGPT é barrado antes de chegar ao MCP.

## 1. Configurar o Auth0 (por ambiente)

1. **API (resource server)**: Applications → APIs → _Create API_.
   - _Identifier_ (audience) = **URL exata do MCP do ambiente**, ex.:
     `https://<projeto>-uat.vercel.app/api/mcp`. O `Auth0JwtVerifier` rejeita tokens cujo
     `aud` não contenha essa URL (o Auth0 pode emitir `aud` em array, ex.: API + `userinfo`).
   - _Permissions_: crie os escopos de cada módulo exposto, ex.: `resources:read`,
     `resources:write`.
2. **Registro dinâmico de cliente**: em _Tenant Settings → Advanced_, habilite o _Dynamic
   Client Registration_ (registro OIDC dinâmico). O ChatGPT usa isso para se registrar
   sozinho. **Riscos e cuidados:**
   - o endpoint de registro fica **público** — qualquer um cria clientes no tenant;
   - clientes dinâmicos são _third-party_: mantenha a **tela de consentimento** obrigatória
     e conceda só os escopos da sua API;
   - só conexões habilitadas em nível de domínio ficam disponíveis para eles (item 3);
   - monitore e limpe periodicamente os clientes registrados (Applications) e alerte sobre
     picos de registro; em Prod, avalie desligar o DCR e pré-registrar os clientes.
3. **Conexões**: a conexão de login (ex.: Username-Password ou Google) precisa estar
   disponível para apps registrados dinamicamente (conexão de domínio/"domain level").
4. **Indicador de recurso**: clientes MCP enviam `resource` (RFC 8707), mas o Auth0
   historicamente espera `audience`. Se ele ignorar `resource`, emite token sem a sua API
   no `aud` e o MCP responde 401 em loop. Ajuste **no Auth0**: habilite no tenant a opção
   que trata `resource` como `audience` (perfil de compatibilidade do _Resource Parameter_;
   confira o nome atual na doc) ou, como contorno, defina a _Default Audience_ do tenant
   como a URL do MCP (afeta todos os clientes do tenant). O campo `resource` em
   `/.well-known/oauth-protected-resource` continua **sempre** igual a `MCP_RESOURCE_URL`.
5. Variáveis do app (por ambiente, nunca commitadas):
   `AUTH0_ISSUER_BASE_URL`, `MCP_RESOURCE_URL` (= audience). Fora do Dev local as duas precisam
   ser `https://`; sem `AUTH0_ISSUER_BASE_URL` o MCP aceita só tokens pessoais.

## 2. Ligar as tools

As tools ficam atrás de flags (ADR-006):

| Flag              | Env (skeleton)        | Padrão        | Efeito                                                     |
| ----------------- | --------------------- | ------------- | ---------------------------------------------------------- |
| `mcp.<ctx>.read`  | `MCP_RESOURCES_READ`  | ligada        | tools de leitura do módulo aparecem                        |
| `mcp.<ctx>.write` | `MCP_RESOURCES_WRITE` | **desligada** | tools de escrita aparecem (se o token tiver `<ctx>:write`) |

As flags MCP dependem da flag da feature (no skeleton, `RESOURCES_ENABLED`): com a feature
desligada nenhuma tool do módulo aparece, mesmo com `MCP_*=on` — o kill switch da feature cobre
todas as bordas.

Ligue a escrita **por ambiente**, conscientemente — comece pelo UAT. Para demonstrar escrita no
UAT, ligue `MCP_RESOURCES_WRITE=on` só no ambiente de UAT.

## 3. Conectar o ChatGPT

1. Ative o **modo desenvolvedor** nas configurações do ChatGPT (área de Apps/Connectors,
   opções avançadas). Requer um plano que suporte connectors customizados.
2. Crie um connector/app com a URL `https://<projeto>-uat.vercel.app/api/mcp` e
   autenticação **OAuth**.
3. O ChatGPT abre o login do Auth0 do UAT → entre com um usuário de teste → consinta os
   escopos.
4. Num chat novo, habilite o connector e pergunte: _"quais são meus recursos?"_.
5. Esperado: a resposta lista **só** os recursos daquele usuário. Tools de escrita só
   aparecem com a flag de escrita ligada e o escopo concedido; o ChatGPT pede confirmação
   antes de executá-las.

## 4. Conectar Claude / Cursor

- **Claude (desktop/web)**: adicione um _custom connector_ com a mesma URL; o fluxo OAuth é
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
- No Dev local, o verificador aceita um PAT de desenvolvimento (`DEV_PERSONAL_TOKEN`, semeado no boot só com
  `APP_ENV=development`) — não há
  OAuth real. **Trava fail-closed:** esse PAT e o seed só existem quando uma variável explícita
  marca o Dev local (ex.: `APP_ENV=development`; **ausente = não é Dev**);
  em UAT/Prod o verificador o **recusa** mesmo que alguém o insira no banco, e o seed se
  recusa a rodar. Nunca reutilize esse valor fora do Dev local.

## Troubleshooting

| Sintoma                           | Causa provável                                                        |
| --------------------------------- | --------------------------------------------------------------------- |
| `401` mesmo após login            | `aud` do token não contém `MCP_RESOURCE_URL` (audience da API errada) |
| ChatGPT não consegue se registrar | Registro dinâmico de cliente desabilitado no tenant                   |
| Tool não aparece                  | Flag desligada ou escopo ausente no token                             |
| `isError` com "tente novamente"   | Erro técnico — veja os logs do ambiente                               |
