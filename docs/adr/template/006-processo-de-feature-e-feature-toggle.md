# 006. Processo de Feature: Entrevista + Plano + Feature Toggle

**Data**: 2026-08-27
**Status**: Aceito

## Contexto

O projeto adota trunk-based ([ADR-005](./005-trunk-based-development.md)), onde
trabalho incompleto vive atrás de **feature flags**, e um fluxo de release
dirigido por PR ([ADR-002](./002-estrategia-de-ambientes.md)). Para que isso
funcione, cada funcionalidade precisa de um **processo mínimo obrigatório** antes
de virar código — caso contrário, features entram sem desenho, sem plano e sem
como serem ligadas/desligadas com segurança em produção.

O pipeline de skills já prevê `brainstorming → writing-plans → implementação →
verification`. Falta **elevar isso a regra arquitetural** e acoplar a decisão de
**feature toggle** ao processo.

## Decisão

**Toda funcionalidade nova segue, sem exceção, três passos antes da implementação:**

1. **Entrevista (brainstorming)** — explorar intenção, requisitos e desenho com o
   usuário (skill `superpowers:brainstorming`). Produz a spec.
2. **Plano** — decompor em tarefas TDD (skill `superpowers:writing-plans`).
   Produz o plano em `docs/superpowers/plans/`.
3. **Prever feature toggle** — **sempre perguntar ao usuário se a funcionalidade
   precisa de um feature toggle.** Se sim, o toggle é desenhado já na spec/plano
   (nome da flag, default, escopo, critério de remoção) e a implementação nasce
   atrás dele. Se não, registrar explicitamente que foi avaliado e dispensado.

A pergunta sobre feature toggle é **obrigatória e explícita** — nunca se assume
silenciosamente que não precisa.

## Consequências

**Fica mais fácil**
- Releases seguros no trunk-based: features incompletas ou arriscadas ficam atrás
  de flag e são ligadas quando prontas.
- Rollback sem redeploy (desligar a flag) para features problemáticas.
- Rastreabilidade: toda feature tem entrevista, plano e decisão de toggle registrada.

**Fica mais difícil / dívidas assumidas**
- Overhead de processo mesmo em features pequenas (mitigado: o brainstorming
  escala o rigor ao tamanho da tarefa).
- Feature flags acumulam se não houver disciplina de remoção — cada toggle deve ter
  critério de remoção definido no plano.

## Alternativas Consideradas

- **Deixar o feature toggle a critério caso a caso, sem pergunta obrigatória** —
  descartado: leva a esquecer o toggle justamente nas features arriscadas, que são
  as que mais precisam dele no trunk-based.
- **Sempre exigir feature toggle** — descartado por gerar flags inúteis em
  mudanças triviais; a regra é **sempre avaliar/perguntar**, não sempre criar.
