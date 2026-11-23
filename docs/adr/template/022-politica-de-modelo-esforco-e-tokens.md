# 022. Política de modelo, esforço, tokens e subagentes

**Data**: 2026-11-23
**Status**: Aceito

## Contexto

O template não dizia qual modelo, qual esforço e quanto contexto usar em cada tarefa, nem quando
delegar a subagentes. O resultado é custo imprevisível, leituras gigantes que enchem o contexto
(e voltam a cada turno pelo cache) e subagentes sem as travas do projeto (regra 0 do `CLAUDE.md`).
As ideias vêm da PR #295 de `gps-repository-templates/template-adp` (outro projeto, usado só como
referência de regras); aqui foram adaptadas às nossas convenções.

## Decisão

1. **Modelo por tipo de trabalho**: Opus julga, projeta e revisa; Sonnet executa (loops de
   edição/teste, varreduras, triagem); Haiku só faz consulta pura.
2. **Esforço por tarefa**, nunca global; só sobe depois de existir uma verificação.
3. **Nada pessoal no `.claude/settings.json` do time**: `model`, `effortLevel` e IDs de modelo
   ficam nas configurações pessoais de cada pessoa.
4. **Subagentes por fase**: spec e plano na sessão principal; implementação em um subagente Sonnet
   por tarefa do plano; revisão e verificação final em Opus. Subagente **nunca** faz push, PR nem
   merge (regra 0).
5. **Disciplina de tokens**: briefing de subagente com parada, orçamento e retorno curto; uma
   sessão por fase; leitura em fatias.
6. **Hook `read-guard`** (`PreToolUse` em `Read`) nega leitura inteira de texto acima de 60 KB e de
   PDF a partir de 1 MB sem `pages`; fail-open; `READ_GUARD=off` desliga.

O passo a passo está no [guia de modelo, esforço e tokens](../../guides/model-effort-tokens-guide.md).

## Consequências

- Custo mais previsível e contexto mais limpo; o Claudinho passa a justificar a escolha de modelo
  ao delegar.
- O hook pode barrar uma leitura legítima; a mensagem ensina a fatiar e há `READ_GUARD=off`.
- Flags e defaults do Claude Code mudam entre versões: o guia manda conferir a documentação oficial.

## Alternativas Consideradas

- **Só o guia, sem hook**: mais barato, mas "leia pequeno" vira só pedido educado.
- **Portar a PR quase literal**: traz peças que não existem aqui (agentes e wiki do ADP) e
  quebra a convenção `.mjs` dos hooks.
- **Fixar modelo/esforço no `settings.json` do time**: sobrescreve a escolha de cada pessoa.
