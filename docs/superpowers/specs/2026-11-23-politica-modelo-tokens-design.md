# Spec: Política de modelo, esforço e disciplina de tokens + read-guard

**Data**: 2026-11-23
**Status**: Aprovada
**Autor(es)**: Fabio Schiozer, Claudinho

> Produzida pela skill `superpowers:brainstorming`. Origem: PR #295 de
> `gps-repository-templates/template-adp` (outro projeto; usado só como referência de regras).
> Spec curta (mudança pequena/média, sem UI nem feature toggle).

## 1. Contexto e Objetivo

O template não diz **qual modelo, esforço e quanto contexto** usar em cada tarefa. O resultado é
custo imprevisível e leituras gigantes que enchem o contexto (e voltam a cada turno pelo cache).
Objetivo: registrar uma política curta e acionável e um hook que barra o erro mais caro (Read de
arquivo grande sem fatia). Chega aos projetos derivados pelo `/template-sync`.

## 2. Não-Objetivos

- Tabela de agentes do ADP (não temos `.claude/agents/`) e tooling de observabilidade de custo.
- Fixar IDs de modelo ou `model`/`effortLevel` no `.claude/settings.json` do time (escolha pessoal).
- Alterar o corpo do `CLAUDE.md`, exceto uma linha de ponteiro para o guia.

## 3. Abordagens consideradas

1. **ADR + guia + hook (escolhida)**: ADR 022 registra a decisão; `docs/guides/model-effort-tokens-guide.md`
   traz a política operacional; `hooks/read-guard/` aplica o que é mecanizável. Segue nosso padrão
   (decisão em ADR, how-to em guia) e o sync já cobre `docs/**` e `hooks/**`.
2. Só o guia, sem hook: mais barato, mas a regra "leia pequeno" vira só pedido educado.
3. Portar a PR quase literal (um doc de governança + hook `.ts`): traz coisas que não existem aqui
   (agentes ADP, `wiki`, `triage`) e quebra a convenção `.mjs` dos hooks.

## 4. Regras de Negócio (conteúdo)

**ADR 022** (curto): adotar política de modelo/esforço/tokens; esforço por tarefa; nada pessoal no
`settings.json` do time; hook fail-open desligável.

**Guia** (adaptado, em português):

- Opus julga/projeta/revisa; Sonnet executa (loops de edição/teste, varreduras, triagem); Haiku só consulta pura.
- Esforço por tarefa; subir só depois de haver verificação; não usar `CLAUDE_CODE_EFFORT_LEVEL` em perfil de shell.
- Ordem de resolução do modelo de subagente e pin dos aliases (Bedrock/gateway) com variáveis `ANTHROPIC_DEFAULT_*_MODEL`, sem IDs hardcoded.
- Disciplina: orquestrador enxuto; briefing de subagente com parada, orçamento e retorno curto (template); uma sessão por fase, `/clear` em vez de `/compact`, cache frio após ~5 min; leitura em fatias.
- **Subagentes por fase** (também ajusta `SKILLS.md`, que hoje só cita `subagent-driven-development` como "alternativa"):
  - spec e plano ficam na **sessão principal** (há conversa com o humano); subagente só como revisor independente, sem o contexto da conversa (ex.: builder check);
  - implementação: **um subagente Sonnet por tarefa** do plano, com o plano já fechado e briefing com parada, orçamento e retorno curto;
  - revisão e verificação final: Opus, na sessão principal ou em revisor independente;
  - subagente **nunca** faz push, PR nem merge (regra 0): isso é da sessão principal; ele herda o perfil arquitetural e a spec como "Já sabido" do briefing.
- Receitas `/goal` e `/loop` usando nossos comandos (`npm test`, `npm run lint`, `npm run check:cenarios`, `gh pr checks`), com limite de turnos e **sem** pular as travas da regra 0 (nada de merge/push na main).
- Sugestão (não instalada) de `## Compact instructions` para o `CLAUDE.md` do projeto.

**Hook `read-guard`** (`PreToolUse` matcher `Read`): nega texto > 60 KB sem `offset`/`limit` e PDF ≥ 1 MB
sem `pages`; imagens e notebooks passam; qualquer erro = sem opinião; `READ_GUARD=off` desliga.
Escrito em `.mjs` como os demais hooks; testes em Vitest (`tests/unit/hooks/`), registrado em `.claude/settings.json`.

## 5. Requisitos não funcionais

Hook < 5 s (timeout 5), sem dependências novas, fail-open. Sem segredos. Guia e ADR passam em `npm run format`.

## 6. Cenários de teste (unitários, sem E2E)

- CT-GUARD-001: texto grande sem fatia → deny com dica `rg -n`/offset.
- CT-GUARD-002: texto grande com `offset` ou `limit`, texto pequeno, arquivo inexistente → passa.
- CT-GUARD-003: PDF ≥ 1 MB sem `pages` → deny com `pdftotext`; com `pages` → passa.
- CT-GUARD-004: imagem/notebook grande → passa; caminho relativo resolve contra `cwd`.
- CT-GUARD-005: `READ_GUARD=off`, JSON inválido e ferramenta ≠ Read → sem saída.

## 7. Critérios de Aceitação

- [x] ADR 022 e guia criados e linkados no `CLAUDE.md` (seção Guias) e no `SKILLS.md` se couber.
- [x] `SKILLS.md` troca "alternativa" por a regra de subagentes por fase (aponta para o guia).
- [x] Hook registrado, testes verdes, `npm run lint`, `type-check`, `test` ok (rodados de novo antes do PR).
- [x] `template-sync.manifest.json` cobre os novos arquivos (já cobre `hooks/**`; conferir `docs/**`).
- [ ] PR aberto (base `main`, sem esteira), template preenchido, UAT desmarcado.

## 8. Itens Futuros

Adotar a receita de observabilidade de custo (status line, relatório de tokens) como recipe opcional, se fizer falta.
