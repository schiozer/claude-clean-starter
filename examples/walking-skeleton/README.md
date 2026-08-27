# Walking Skeleton — fatia Resources

Exemplo **autocontido** que prova o template ponta a ponta: Clean Architecture
(domain → application → infrastructure → presentation), feature toggle e testes,
sem tocar Neon/Auth0 reais (usa in-memory + auth stub).

## Rodar

```bash
npm install
cp .env.example .env.local   # RESOURCES_ENABLED=on
npm run dev                  # http://localhost:3000/resources
```

## Testar

```bash
npm run lint && npm run type-check && npm test && npm run build
```

## Feature toggle

`RESOURCES_ENABLED` (fail-closed): ausente/≠`on` → a fatia fica desativada
(página avisa, API responde 404). Ver ADR-006.

## Mapeamento de deploy (ver docs/guides/deploy-ci-guide.md)

- **PR → UAT**: preview deployment (site/celular).
- **merge na `main` → Prod**: production deployment.
- Trocar in-memory/stub por `NeonResourceRepository`/`Auth0AuthProvider` (mesmas
  interfaces) quando houver infra real — ver ADRs 003 e 004.
