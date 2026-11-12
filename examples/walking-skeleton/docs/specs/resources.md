# Spec: Recursos (exemplo do walking skeleton)

**Data**: 2026-11-11
**Status**: Aprovada
**Autor(es)**: Claudinho (rascunho), QA (revisão dos cenários)

> Spec de **exemplo** do módulo `resources` do walking skeleton, escrita no formato do
> [`_TEMPLATE.md`](../../../../docs/superpowers/specs/_TEMPLATE.md). Serve de modelo para a seção
> "Cenários de teste": cada cenário tem um teste Playwright com o mesmo ID em
> `examples/walking-skeleton/tests/e2e/resources/`, conferido pelo `npm run check:cenarios`.

## 1. Contexto e Objetivo

O usuário guarda recursos (ex.: um plano de estudos) com um título e os vê numa lista. É a menor
fatia vertical do skeleton: tela, API REST e tool MCP passando pelo mesmo `ResourceService`.

## 2. Não-Objetivos

- Editar, publicar ou apagar recursos.
- Criar recursos pelo MCP em produção (a escrita MCP nasce desligada — ADR-012).

## 3. Fluxo do Usuário

1. O usuário logado abre `/resources` e vê os recursos dele.
2. Preenche o "Título" (3 a 100 caracteres) e clica em "Criar"; o recurso entra na lista e o campo
   é limpo.
3. Com título curto, o botão "Criar" fica desabilitado; se a API receber o título mesmo assim, a
   recusa aparece como aviso (erro funcional), nunca como alerta.

## 4. Componentes / Telas

- Tela `/resources` (`ResourcesView` + `useResources`).
- `GET`/`POST /api/resources` (sessão web).
- Tools MCP `list_resources` (leitura, flag `mcp.resources.read`) e `create_resource` (escrita,
  flag `mcp.resources.write`, desligada por padrão) em `/api/mcp`.

## 5. Regras de Negócio

- Título com 3 a 100 caracteres após `trim` (`createResourceSchema`, mesmo schema na tela e na API).
- Cada ator só vê os próprios recursos (dono e tenant derivados do `actor`, nunca do input).
- Sem identidade → 401; sem escopo → `FORBIDDEN` (fail-closed).

## 6. Dados / Queries

`Resource { id, tenantId, ownerId, title, createdAt }`; listagem por dono, paginada (`limit` ≤ 50
e `cursor`).

## 7. Requisitos não funcionais

Segue o baseline ([`docs/rnf.md`](../../../../docs/rnf.md)).

## 8. Cenários de teste

> O isolamento entre atores é regra do guard do `ResourceService` (dono derivado do `actor`); o
> CT-RES-004 o verifica pela borda MCP, porque a sessão web do modo e2e tem um único usuário.
> A tela mostra só a 1ª página da API: os **20 recursos mais recentes** (a listagem é do mais novo
> ao mais antigo). Os cenários de tela que criam um recurso e o procuram na lista (CT-RES-001,
> CT-RES-003 e o USA-003 do baseline) dependem disso: com a ordem antiga (mais antigo primeiro), um
> usuário de teste com mais de 20 recursos acumulados esconderia o recurso recém-criado.
> CA-3 e CA-4 são só de backend: cobertos por `@sistemico`, sem `@e2e`. O 401/403 do MCP é coberto
> pelo baseline (RNF-SEG-003 e RNF-SEG-006).

### CT-RES-001 — Criar um recurso e vê-lo na lista

Tipo: @e2e Destino: @doc @demo
Critério: CA-1 Perfil: usuário final

Dado que estou logado como usuário final
Quando abro a lista de recursos
E preencho o título "Plano de estudos"
E clico em "Criar"
Então vejo o recurso "Plano de estudos" na lista
E o campo "Título" fica vazio

### CT-RES-002 — Título curto é recusado com aviso

Tipo: @e2e
Critério: CA-2 Perfil: usuário final

Dado que estou logado como usuário final
Quando abro a lista de recursos
E preencho o título "ab"
Então o botão "Criar" fica desabilitado
Quando o título "ab" chega à API por fora da tela
Então vejo o aviso com a mensagem da API
E não vejo alerta de erro técnico

### CT-RES-003 — Criar um recurso só com o teclado

Tipo: @usabilidade
Critério: CA-1 Perfil: usuário final

Dado que estou logado como usuário final
Quando abro a lista de recursos
E chego ao campo "Título" com Tab
E digito "Plano de estudos"
E aperto Tab até o botão "Criar"
E aperto Enter
Então vejo o recurso "Plano de estudos" na lista

### CT-RES-004 — A API lista só os recursos do ator e recusa quem não está logado

Tipo: @sistemico
Critério: CA-3

Dado que o usuário final criou o recurso "Plano de estudos" com a sessão dele
Quando ele lista os recursos em "GET /api/resources"
Então o recurso "Plano de estudos" aparece para ele
Quando outro ator lista os recursos pela tool MCP "list_resources"
Então o recurso "Plano de estudos" não aparece para o outro ator
Quando alguém sem sessão tenta criar um recurso em "POST /api/resources"
Então a API responde 401 e nada é criado

### CT-RES-005 — O MCP não oferece a criação com a escrita desligada

Tipo: @sistemico
Critério: CA-4

Dado que a flag "mcp.resources.write" está desligada
Quando o usuário final pede a lista de tools ao MCP com o token pessoal dele
Então a tool "list_resources" aparece na lista
E a tool "create_resource" não aparece

### CT-RES-006 — Ver a lista de recursos como time interno

Tipo: @e2e Destino: @doc
Critério: CA-1 Perfil: time interno

Dado que estou logado como time interno
Quando abro a lista de recursos
Então vejo a tela "Resources"
E vejo a lista de recursos sem erro

## 9. Critérios de Aceitação

- **CA-1**: o usuário logado cria um recurso com título de 3 a 100 caracteres e o vê na lista.
- **CA-2**: título fora da regra é recusado: a tela não deixa enviar e a API devolve
  `VALIDATION_ERROR`, mostrado como aviso (`role="status"`), não como alerta.
- **CA-3**: `GET /api/resources` lista só os recursos do ator, do mais novo ao mais antigo; sem
  sessão, a API responde 401.
- **CA-4**: com a flag `mcp.resources.write` desligada (padrão), `create_resource` não aparece em
  `tools/list` do MCP.

## 10. Itens Futuros

- Editar e apagar recursos.
- Paginação na tela (hoje ela mostra só a primeira página da API).
