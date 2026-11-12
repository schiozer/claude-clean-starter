# Spec: Ajuda (exemplo do walking skeleton)

**Data**: 2026-11-11
**Status**: Aprovada
**Autor(es)**: Claudinho (rascunho), QA (revisão dos cenários)

> Spec de **exemplo** do módulo `ajuda` do walking skeleton, no formato do
> [`_TEMPLATE.md`](../../../../docs/superpowers/specs/_TEMPLATE.md). A ajuda é a documentação
> interativa gerada dos cenários `@doc` (spec
> [e2e-regressao-docs §9.1](../../../../docs/superpowers/specs/2026-11-09-e2e-regressao-docs-design.md)).

## 1. Contexto e Objetivo

Todo cenário `@doc` de uma spec vira uma página de ajuda: `npm run docs:gerar` roda o cenário no
navegador, captura um screenshot por passo e grava `docs/ajuda/<CTX>/<ID>.json` + as imagens. O
usuário logado abre `/ajuda`, escolhe a página e avança/volta passo a passo.

## 2. Não-Objetivos

- Tour dentro da própria tela (item futuro da spec e2e-regressao-docs §11).
- Vídeos de demo/treinamento (Bunny, atrás de `DEMOS_BUNNY`).
- Tool MCP da ajuda: o ADR-012 manda perguntar; esta spec não pede (YAGNI).

## 3. Fluxo do Usuário

1. O usuário logado abre `/ajuda` e vê as páginas que pode ver, agrupadas por contexto.
2. Abre uma página (`/ajuda/<ID>`) e vê o passo 1: o screenshot e a legenda (o texto do passo).
3. Troca de passo com "Anterior"/"Próximo" ou com as setas ← e → do teclado.

## 4. Componentes / Telas

- Tela `/ajuda` (`AjudaIndice`) e `/ajuda/[id]` (`AjudaPassoAPasso`).
- `GET /api/ajuda/[id]/imagem/[n]`: o screenshot do passo `n`, com o mesmo guard da página (as
  imagens nunca ficam em `public/`).
- `AjudaService` + `FsAjudaSource` (lê `docs/ajuda/`, que entra no bundle do servidor).

## 5. Regras de Negócio

- Ler a ajuda exige o escopo `ajuda:read` (perfis `usuario` e `interno`).
- Página `time interno` exige também `ajuda:interno` (só o perfil `interno`). Sem ele, ela não
  aparece na lista e abrir ou pedir a imagem dela responde "não encontrada" (não revela que existe).
- Sem `docs/ajuda/` (ou vazia), `/ajuda` mostra uma mensagem amigável.

## 6. Dados / Queries

`AjudaDoc { id, titulo, perfil, passos: [{ texto, imagem }] }`, gerado pelo `docs:gerar`; a sigla
do contexto vem do ID (`CT-RES-001` → `RES`).

## 7. Requisitos não funcionais

Segue o baseline ([`docs/rnf.md`](../../../../docs/rnf.md)). `/ajuda` está em "Telas"; `/ajuda/[id]`
é rota dinâmica e fica em "Exclusões", coberta pelo CT-AJU-001.

## 8. Cenários de teste

> O CT-AJU-001 depende das páginas geradas e commitadas em `docs/ajuda/` (CT-RES-001 é
> `usuário final`; CT-RES-006 é `time interno`). O filtro por perfil e o guard das imagens também
> têm testes de unidade (`AjudaService`, bordas).

### CT-AJU-001 — Navegar pela ajuda só com o teclado

Tipo: @usabilidade
Critério: CA-1, CA-2 Perfil: usuário final

Dado que estou logado como usuário final
Quando abro a ajuda
Então vejo a página "Criar um recurso e vê-lo na lista"
E não vejo a página "Ver a lista de recursos como time interno"
Quando chego à página "Criar um recurso e vê-lo na lista" com Tab e aperto Enter
Então vejo o passo 1 com o screenshot e a legenda
Quando aperto Tab até o botão "Próximo" e aperto Enter
Então vejo o passo 2
Quando aperto Shift+Tab até o botão "Anterior" e aperto Enter
Então volto ao passo 1
Quando aperto a seta para a direita
Então avanço de novo para o passo 2

### CT-AJU-002 — Ver a ajuda quando os vídeos estão indisponíveis

Tipo: @e2e
Critério: CA-3 Perfil: usuário final

Dado que estou logado como usuário final
Quando abro a página "Criar um recurso e vê-lo na lista" da ajuda
Então vejo o passo 1 com o screenshot e a legenda
E vejo o aviso "Vídeos indisponíveis no momento."

## 9. Critérios de Aceitação

- **CA-1**: o usuário logado vê em `/ajuda` só as páginas do perfil dele e navega uma página passo
  a passo (screenshot + legenda), inclusive só com o teclado.
- **CA-2**: página `time interno` só aparece e só abre (inclusive as imagens) com `ajuda:interno`.
- **CA-3**: com os vídeos ligados e o catálogo inacessível, a página da ajuda mostra a documentação
  e o aviso, sem erro.

## 10. Itens Futuros

- Busca na ajuda e nome legível do contexto (hoje, a sigla).
- Vídeo da demo na página da feature (`DEMOS_BUNNY`).
