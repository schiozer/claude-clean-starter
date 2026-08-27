# Spec: Walking Skeleton — fatia "Resources"

**Data**: 2026-08-27
**Status**: Rascunho
**Autor(es)**: Claudinho (com Fabio Schiozer)

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano
> e a implementação.

## 1. Contexto e Objetivo

O repositório é um **template** ("não é uma app"). Para provar que a disciplina
do template (pipeline de skills + Clean Architecture + regras dos ADRs) produz
algo coeso, criamos um **walking skeleton**: uma fatia fina, autenticada,
atravessando **todas as camadas** da Clean Architecture, atrás de um **feature
toggle**.

O objetivo **não** é um produto, e sim um **exemplo executável e testável** que
exercite domain → application → infrastructure → presentation com um caso de uso
real mínimo, servindo de referência viva para quem instanciar o template.

Vive em `examples/walking-skeleton/`, isolado, com `package.json` próprio, para
**não** violar a promessa do template (não travar stack na raiz).

## 2. Não-Objetivos

- **Não** provisiona nem conecta Neon/Auth0 reais (usa in-memory + auth stub).
- **Não** implementa update/delete de resources (apenas listar e criar).
- **Não** cobre E2E/Playwright nesta fatia.
- **Não** define sistema de estilo/design tokens além do mínimo para a página funcionar.
- **Não** decide host/CI vinculante (ver [guia de Host & CI](../../guides/deploy-ci-guide.md)).

## 3. Fluxo do Usuário

Happy path (flag `RESOURCES_ENABLED=on`):

1. Usuário (dev fixo do `StubAuthProvider`) acessa `/resources`.
2. A página lista os resources **do próprio usuário** (vazio no início).
3. Usuário preenche o campo "título" e envia o formulário.
4. Título válido (≥ 3 chars) → resource criado, aparece na lista.
5. Título inválido → mensagem **funcional acionável** ("Título deve ter ao menos 3 caracteres"), sem alarme de erro técnico.

Desvios:

- Flag `RESOURCES_ENABLED=off` → `/resources` mostra aviso "funcionalidade
  desativada" e `POST /api/resources` responde 404; nenhum acesso a use-case.
- Erro técnico (ex.: falha inesperada) → mensagem genérica "tente novamente".

## 4. Componentes / Telas

- **Rota API (BFF)** `app/api/resources/route.ts`:
  - `GET` → lista resources do usuário autenticado (via guard).
  - `POST` → valida payload (Zod), chama `CreateResourceUseCase`, traduz erros.
  - Ambos checam a flag antes de qualquer coisa (fail-closed → 404 se off).
- **Página** `app/resources/page.tsx` (Server Component): checa a flag (estado
  derivado), renderiza o componente client.
- **Componente client** `ResourcesView` + **hook** `useResources` (encapsula
  fetch/estado loading/error/data e o submit).

## 5. Regras de Negócio

- **Entidade `Resource`**: `id`, `title`, `ownerId`, `createdAt`. Invariante:
  `title` com **≥ 3** e **≤ 100** caracteres (valida no construtor → `DomainError`).
- **Validação de borda (Zod)** `createResourceSchema`: `{ title: string.min(3).max(100) }`.
  Mesmo schema no cliente (form) e no servidor (rota).
- **Autorização (guard, fail-closed)**: identidade vem do `IAuthProvider`; um
  usuário só lista/cria os **seus** resources (`ownerId === user.id`). Sem usuário
  → sem acesso (401).
- **Feature toggle**: `resourcesEnabled` é **estado derivado** de
  `RESOURCES_ENABLED` (env), avaliado na borda (página + rota). Nunca guardado/
  sincronizado manualmente.
- **Erros**: funcional (`VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`) vs
  técnico (sem code/500) — mapeados para mensagens user-friendly.

## 6. Dados / Queries

Sem banco real. `InMemoryResourceRepository` (implementa `IResourceRepository`):

- `findByOwnerId(ownerId)` → `Resource[]` (usado por `ListResourcesUseCase`).
- `save(resource)` → persiste em memória (usado por `CreateResourceUseCase`).
- `findById(id)` / `delete(id)` existem na interface, mas não são exercitados
  nesta fatia (YAGNI — presentes só para honrar o contrato da interface).

`StubAuthProvider` (implementa `IAuthProvider`): retorna um usuário de dev fixo
(`{ id: 'dev-user', ... }`).

## 7. Testes

**Unit** (Vitest):
- `Resource` — construtor aceita título válido; rejeita `< 3` e `> 100` (`DomainError`).
- `CreateResourceUseCase` — cria e chama `repository.save` 1x; propaga erro de validação de domínio.
- `ListResourcesUseCase` — retorna só os resources do `ownerId`.
- Guard authz — nega sem usuário; nega acesso a resource de outro dono.
- Helper de feature flag — `on/off/ausente` → booleano derivado correto (default: off).

**Integration** (Vitest, testando a rota com repo in-memory):
- `POST /api/resources` com título válido → 201 + corpo do resource.
- `POST` com título inválido → 400 + `code: VALIDATION_ERROR`.
- `GET /api/resources` → 200 + lista do usuário.
- Flag `off` → `GET`/`POST` → 404, use-case não é chamado.

> Nota: como o `StubAuthProvider` sempre devolve um usuário, o caminho **401
> (sem usuário)** é coberto no **unit do guard** (com um provider que retorna
> `null`), não na rota.

## 8. Critérios de Aceitação

- [ ] `examples/walking-skeleton/` com `package.json` próprio; `npm ci && npm run
      lint && npm run type-check && npm test && npm run build` passam **sem secrets**.
- [ ] Todas as camadas presentes (domain/application/infrastructure/presentation/shared)
      e a dependência aponta sempre para dentro (DIP).
- [ ] Fatia funciona com a flag `on` e é bloqueada (fail-closed) com a flag `off`.
- [ ] Autorização fail-closed: sem usuário → 401; dono só vê o seu.
- [ ] Validação Zod compartilhada front/back; erros funcionais vs técnicos distinguidos.
- [ ] Testes unit + integration cobrindo os itens da seção 7, todos verdes.
- [ ] Novo job no `ci.yml` roda o exemplo (install/lint/type-check/test/build) e passa.
- [ ] `README` do exemplo mapeia PR→UAT/merge→Prod conforme o guia de Host & CI.
- [ ] Sem `any`, sem `console.log`, sem secrets versionados.

## 9. Itens Futuros

- Trocar in-memory por `NeonResourceRepository` real + `Auth0AuthProvider`
  (mesmas interfaces) e provisionar ambientes.
- Update/delete de resources; paginação.
- E2E com Playwright cobrindo o happy path e o gate da flag.
- Deploy real no Vercel (preview=UAT, prod) exercitando a integração Neon.
