---
name: init-project
description: Use ao iniciar um projeto a partir do template ou ao revisitar a tecnologia de um projeto existente — mostra as opções do catálogo de stack com prós, contras e recomendação, registra a meta num ADR por PR e roda os runbooks de setup (projeto novo) ou de migração (projeto existente), ver ADR-019.
---

# Init Project

## Visão Geral

Escolhe a arquitetura-meta do projeto **só pelo catálogo** (`stack.catalog.json`, lido por
`scripts/stack/catalog.mjs`) e leva o projeto até ela pelos runbooks. Decisão em
[ADR-019](../../../docs/adr/template/019-stack-por-catalogo.md).

- **Só o catálogo**: opção fora de `stack.catalog.json` não é oferecida nem aceita. Se o humano
  quiser outra tecnologia, ela precisa entrar primeiro no template (catálogo + ADR + runbooks), e
  só depois volta aqui.
- Nenhum comando mutante fora de runbook: operações vão pela skill `runbook-execution`, com as
  classes R0–R3 do ADR-013. Arquivos do repositório mudam só em feature branch + PR.
- Nunca commita na `main`, nunca mergeia, nunca marca o UAT (regras 0, 5, 8 e 10 do `CLAUDE.md`).

Checklist (crie uma tarefa por item):

1. Retrato atual pela `architecture-review`.
2. Escolha por dimensão.
3. Resumo atual → meta → runbook e código do app.
4. PR com o ADR de stack (e arquivos de configuração).
5. Runbooks: setup (projeto novo) ou migração (projeto existente).
6. Relatório.

## 1. Retrato atual

Invoque a skill `architecture-review` no modo chamado pela `init-project`: ela devolve o retrato
(dimensão → valor → evidência) sem abrir PR próprio.

**Projeto novo** = sem ADR `*-stack-tecnologica.md`, sem `deploy.config.json` e sem código de app
além do template. Nesse caso o retrato é vazio.

## 2. Escolha por dimensão

Para cada dimensão, na ordem do catálogo, mostre:

- o valor atual (se houver);
- cada opção com `nome`, `pros` e `contras`;
- a **recomendada** (`recomendada: true`) e o `porque` dela. Hoje a base recomendada é
  `vercel` + `neon` + `auth0`.

O humano escolhe, uma dimensão por vez (pode manter a atual). Dimensão com uma opção só (ex.:
`banco`, `auth`, `e2e`) é mostrada como informação, sem pergunta. `perfil` não tem recomendada:
depende do projeto (ADR-011).

Em **projeto existente**, `perfil` não muda por aqui: a promoção `mvp-primeiro` → completo é o
processo do ADR-011 (ADR do projeto + campo do `CLAUDE.md`). Aponte para ele e mantenha o valor.

## 3. Resumo

Mostre a tabela dimensão → atual → meta → runbook (`setup` em projeto novo, `migracao` em
projeto existente). Para o `formato` da meta, liste os itens de `codigoDoApp[<formato>]` das
opções escolhidas (ex.: `expo-api` + `heroku` → `Procfile` e build apontando para `apps/api`,
servidor Node contínuo). Código do app **não** é feito por esta skill: cada item vira PR próprio,
antes do runbook de migração.

Dimensão de projeto existente que muda e tem `migracao: null` → **migração não suportada** pelo
template: avise ("migração de `<dimensão>` não suportada pelo template") e mantenha o valor
atual na meta. Nunca improvise comandos para migrar.

Peça a confirmação do humano antes de seguir.

## 4. PR

Um único PR, pela feature branch `docs/stack-tecnologica-<AAAA-MM-DD>`, com:

- o ADR novo `docs/adr/NNN-stack-tecnologica.md` (formato da `architecture-review`, passo 6) com a
  **meta** na tabela `Dimensão | Escolha | ADR de detalhe | Desde`. `Desde` mantém a data antiga
  das dimensões que não mudaram. Projeto existente sem ADR de stack: um ADR só, com o retrato
  (valores anteriores) no **Contexto**;
- o ADR vigente anterior, se houver, com o status trocado para `Status: Substituído por [NNN]`
  (única edição permitida em ADR antigo);
- `deploy.config.json` quando o `host` muda (só identificadores não secretos; os blocos de
  `heroku`/`cloudrun` vêm do runbook do host);
- `**Perfil arquitetural**:` no `CLAUDE.md` em projeto novo.

Variáveis do GitHub (`SPEC_GATE`, `DEMOS_BUNNY`) **não** vão no PR: são passo de runbook. Conta
`gh` correta antes do push (regra 5); PR pelo `.github/pull_request_template.md` com
`Spec: n/a — escolha de stack`; o merge é do humano (R3). Sem mudança nenhuma → sem ADR novo e
sem PR.

## 5. Runbooks

Pela skill `runbook-execution`, um runbook por vez, cada passo com a sua classe de risco.

- **Projeto novo**: os `setup` das escolhas. Primeiro `docs/runbooks/bootstrap-ambientes.md`
  (que já chama o bloco do host), depois os demais na ordem do catálogo. Runbook repetido entre
  dimensões (ex.: `bootstrap-ambientes.md` de `banco` e `auth`) roda **uma vez**. Opção com
  `setup: null` não roda nada.
- **Projeto existente**: só as dimensões cujo valor muda, pela `migracao` (ex.: `host` →
  `docs/runbooks/migrar-host.md`; ligar/desligar `mcp`, `video` e `specGate` pelo runbook
  apontado, que tem os dois caminhos). Os PRs de código do app (passo 3) vêm antes.

Runbook com `<preencher>` no caminho → o `runbook-execution` para e pede os valores; não invente.

## 6. Relatório

Meta final, link do PR, runbooks executados (e onde ficou o registro de cada um), dimensões com
migração não suportada e itens de código do app pendentes.
