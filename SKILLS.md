# Skills

Este documento mapeia as skills do agente ao workflow de desenvolvimento. O
agente descobre as skills instaladas em `.claude/skills/`; aqui adicionamos o que
ele não infere sozinho: qual skill pertence a cada fase e como as skills do
plugin **superpowers** se encadeiam.

Antes de invocar qualquer skill, o agente deve ter lido `ARCHITECTURE.md` e
`BEST_PRACTICES.md`. Para trabalho em features, leia também a spec relevante em
`docs/superpowers/specs/`.

## Pipeline de Skills

Fluxo padrão para qualquer feature nova:

```
brainstorming → writing-plans → [mvp-development | post-mvp-development] → verification-before-completion
```

Nunca pule o brainstorming em features novas. A spec que ele produz é o contrato
para tudo que vem depois.

## Skills por Fase

### Design — Autoria de Spec
| Skill | Origem | Papel |
|---|---|---|
| `superpowers:brainstorming` | Superpowers | **Comece aqui.** Explora requisitos, produz uma spec em `docs/superpowers/specs/`. |

### Planejamento — Decomposição em Tarefas
| Skill | Origem | Papel |
|---|---|---|
| `superpowers:writing-plans` | Superpowers | Lê a spec, produz um plano em `docs/superpowers/plans/`. Decompõe em tarefas TDD. |

### Construção — Implementação
| Skill | Origem | Papel |
|---|---|---|
| `mvp-development` | Projeto | Fase inicial/MVP. Arquitetura simples (acesso direto a dados, sem use-cases). |
| `post-mvp-development` | Projeto | Fase madura. Clean Architecture (domain → application → infrastructure → presentation). |
| `superpowers:test-driven-development` | Superpowers | Testes antes da implementação — vale para todo código. |
| `superpowers:systematic-debugging` | Superpowers | Diagnóstico estruturado antes de qualquer correção. |
| `superpowers:executing-plans` | Superpowers | Executa o plano tarefa a tarefa, com revisões. |
| `superpowers:subagent-driven-development` | Superpowers | Alternativa: despacha subagentes em paralelo por tarefa. |

### Revisão — Verificação
| Skill | Origem | Papel |
|---|---|---|
| `superpowers:verification-before-completion` | Superpowers | Checagens antes de declarar concluído ou abrir PR. |
| `superpowers:requesting-code-review` | Superpowers | Estrutura o pedido de revisão. |

### Transversais
| Skill | Origem | Papel |
|---|---|---|
| `superpowers:brainstorming` | Superpowers | Também usável para trabalho exploratório, ADRs ou discussões de arquitetura. |
| `superpowers:using-git-worktrees` | Superpowers | Isola o trabalho de feature quando necessário. |
| `superpowers:dispatching-parallel-agents` | Superpowers | Para 2+ tarefas independentes sem estado compartilhado. |

> Adicione aqui skills específicas do seu projeto (ex.: uma skill de migração de
> infraestrutura) à medida que forem criadas em `.claude/skills/`.
