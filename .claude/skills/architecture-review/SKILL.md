---
name: architecture-review
description: Use para saber qual é a stack de um projeto (perfil, formato, host, banco, auth, MCP, vídeo, gate, E2E) — acha o ADR de stack vigente e confere com o estado real, ou levanta a stack com evidências e gera o ADR por PR. Chamada também pela init-project, ver ADR-019.
---

# Architecture Review

## Visão Geral

Todo projeto registra a stack num ADR **do projeto**, `docs/adr/NNN-stack-tecnologica.md`, para
ninguém precisar garimpar o código a cada pergunta. Esta skill acha esse ADR ou o gera. As
dimensões e opções válidas vêm do catálogo `stack.catalog.json` na raiz (lido e validado por
`scripts/stack/catalog.mjs`). Decisão em
[ADR-019](../../../docs/adr/template/019-stack-por-catalogo.md).

- Só leitura (R0) até gerar o ADR; nenhum comando mutante fora de feature branch + PR.
- Nunca commita na `main`, nunca mergeia, nunca marca o UAT (regras 0, 5 e 8 do `CLAUDE.md`).
- Não corrige divergências sozinha: aponta e sugere.

Checklist (crie uma tarefa por item):

1. Ler o catálogo.
2. Achar o ADR vigente.
3. Achou → conferir com o estado real.
4. Não achou → levantar a stack com evidências.
5. Confirmar o retrato com o humano.
6. Gerar o ADR e abrir o PR (se não foi chamada pela `init-project`).
7. Entregar o relatório.

## 1. Ler o catálogo

`node -e "import('./scripts/stack/catalog.mjs').then((m) => console.log(JSON.stringify(m.lerCatalog(), null, 2)))"`

As dimensões, na ordem do catálogo, são as linhas do ADR. Um valor fora das opções do catálogo
nunca vira escolha: vai para **Fora do catálogo**.

## 2. Achar o ADR vigente

Liste `docs/adr/*-stack-tecnologica.md` (fora de `docs/adr/template/`). **Vigente** = o de
**maior** `NNN` cuja linha de status é `**Status**: Aceito` (procure por `Aceito`, não pelo
texto sem negrito). Os anteriores têm `**Status**: Substituído por [NNN]` e só servem de
histórico.

## 3. Achou → conferir com o estado real (R0)

Leia a tabela `Dimensão | Escolha | ADR de detalhe | Desde` e confira o que dá para verificar
agora:

| Dimensão   | Onde conferir                                                             |
| ---------- | ------------------------------------------------------------------------- |
| `perfil`   | `**Perfil arquitetural**:` no `CLAUDE.md`                                 |
| `host`     | `host` do `deploy.config.json` (ausente ou vazio = `vercel`)              |
| `video`    | `DEMOS_BUNNY` em `gh variable list --repo <owner/repo>` (`on` = `bunny`)  |
| `specGate` | `SPEC_GATE` em `gh variable list --repo <owner/repo>` (`on` = `on`)       |
| `formato`  | estrutura: `apps/mobile` + `apps/api` = `expo-api`; senão `next-monolito` |

Divergência → aponte no relatório (ADR diz X, estado real diz Y, com `arquivo:linha`) e sugira
atualizar o ADR pela `init-project`. Sem divergência → relatório e fim, **sem ADR novo**.

## 4. Não achou → levantar a stack (R0)

Para cada dimensão, proponha o valor com evidência `arquivo:linha`:

- os itens da tabela do passo 3;
- as dependências de todos os `package.json` (Neon `@neondatabase/serverless`, Auth0, Expo,
  Hono, Next.js, Playwright, `@modelcontextprotocol/sdk`, Bunny);
- `src/shared/mcp/` ou `app/api/mcp` (borda MCP) e as flags `mcp.*`;
- os ADRs do projeto em `docs/adr/` (fora de `template/`), que viram candidatos a **ADR de
  detalhe**.

O que não der para inferir vira pergunta ao humano, **uma de cada vez**, com as opções do
catálogo. Tudo o que o projeto usa e o catálogo não tem (ex.: Vercel Blob, outro banco) entra em
**Fora do catálogo**, sem dimensão.

## 5. Confirmar o retrato

Mostre o **retrato**: dimensão → valor → evidência (`arquivo:linha`) → ADR de detalhe (o ADR do
template da opção no catálogo + os ADRs do projeto achados). O humano confirma ou corrige; os
ADRs do projeto em "ADR de detalhe" só entram se ele confirmar.

Chamada pela `init-project`: devolva o retrato e pare aqui (ela gera o ADR com a meta).

## 6. Gerar o ADR e abrir o PR

1. `NNN` = próximo número livre em `docs/adr/` (fora de `template/`).
2. Crie `docs/adr/NNN-stack-tecnologica.md` pelo formato de `docs/adr/000-template.md`:
   - título `# NNN. Stack tecnológica`, `**Data**: <hoje>`, `**Status**: Aceito`;
   - **Contexto**: como o retrato foi levantado (evidências resumidas);
   - **Decisão**: a tabela com os `id` do catálogo:

     ```markdown
     | Dimensão | Escolha | ADR de detalhe                          | Desde      |
     | -------- | ------- | --------------------------------------- | ---------- |
     | host     | vercel  | [018](template/018-camada-de-deploy.md) | AAAA-MM-DD |
     ```

     `Desde` = data do ADR de stack em que o valor apareceu pela primeira vez (no primeiro ADR,
     a data dele).

   - `## Fora do catálogo` (lista, pode ficar vazia com "Nada.");
   - **Consequências** e **Alternativas Consideradas** curtas.
3. Feature branch `docs/adr-stack-tecnologica-<AAAA-MM-DD>`, commit
   `docs(adr): registra a stack tecnológica do projeto`, conta `gh` correta (regra 5), push e
   PR pelo template `.github/pull_request_template.md` com `Spec: n/a — registro de stack`. O
   merge é do humano.

O ADR é do projeto: o template-sync nunca toca nele (ADR-015).

## 7. Relatório

Tabela dimensão → valor → evidência → ADR de detalhe, a seção Fora do catálogo, as divergências
(se houver) e o link do PR (se gerou).
