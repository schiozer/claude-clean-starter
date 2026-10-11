# Walking Skeleton — fatia Resources

Exemplo **autocontido** que prova o template ponta a ponta no perfil **completo**
(ADR-011): módulo `src/modules/resources/` (domínio + `ResourceService` + REST + MCP),
feature toggles e testes, sem tocar Neon/Auth0 reais (repositório in-memory, login stub
no Dev e tokens pessoais in-memory).

```
src/
├── modules/resources/{domain,application,infrastructure,interfaces/{http,mcp}}/
├── shared/{kernel,auth,mcp}/ + errors.ts, handleApiError.ts, logError.ts, featureFlags.ts
├── ui/{components,hooks}/
├── composition.ts            # único lugar que instancia infrastructure/
└── app/                      # rotas só delegam: api/resources, api/mcp, .well-known/…
```

## Rodar

```bash
npm install
cp .env.example .env.local   # APP_ENV=development, RESOURCES_ENABLED=on, MCP_*
npm run dev                  # http://localhost:3000/resources
```

## MCP local

1. Em `.env.local`, defina `DEV_PERSONAL_TOKEN` (comando no `.env.example`).
2. `npx @modelcontextprotocol/inspector` → transporte _Streamable HTTP_,
   URL `http://localhost:3000/api/mcp`, header `Authorization: Bearer <DEV_PERSONAL_TOKEN>`.
3. `tools/list` mostra `list_resources`; `create_resource` só com `MCP_RESOURCES_WRITE=on`.

Conectar o ChatGPT ao UAT (OAuth via Auth0): ver `docs/guides/mcp-guide.md`.

## Testar

```bash
npm run lint && npm run type-check && npm test && npm run build
```

## Feature toggles (ADR-006)

| Env                   | Padrão  | Efeito                                                         |
| --------------------- | ------- | -------------------------------------------------------------- |
| `RESOURCES_ENABLED`   | off     | página e `/api/resources` (desligado → aviso / 404)            |
| `MCP_RESOURCES_READ`  | on      | `list_resources`                                               |
| `MCP_RESOURCES_WRITE` | **off** | `create_resource` (precisa também do escopo `resources:write`) |

As flags `MCP_*` só valem com `RESOURCES_ENABLED=on`: desligar a feature desliga também as
tools MCP dela (kill switch único).

## Mapeamento de deploy (ver docs/guides/deploy-ci-guide.md)

- **PR → UAT**: preview deployment (site/celular).
- **merge na `main` → Prod**: production deployment.
- O login stub da web só existe com `APP_ENV=development`: em UAT/Prod `/api/resources`
  responde **401** até existir um `IAuthProvider` real (Auth0, ADR-004). O MCP em UAT
  funciona com OAuth do Auth0 (`AUTH0_ISSUER_BASE_URL` + `MCP_RESOURCE_URL`).
- Trocar in-memory por `NeonResourceRepository` / tabela de PATs / rate limit em Postgres
  (mesmas interfaces) quando houver infra real — ver ADRs 003, 008 e 010.
