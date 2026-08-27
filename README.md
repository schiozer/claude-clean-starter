# claude-clean-starter

Template de **disciplina + esteira** para projetos assistidos pelo Claude
(Claudinho). **Não é uma aplicação** — não traz `src/` de produto nem trava uma
stack. Ele reúne o que é **geral e reutilizável**: direção arquitetural, boas
práticas, o pipeline de skills (superpowers) e o tooling de qualidade.

## O que vem dentro

```
.
├── CLAUDE.md            # Instruções para o agente (regras, pipeline, persona Claudinho)
├── ARCHITECTURE.md      # Clean Architecture, SOLID, camadas, MVP vs Pós-MVP
├── BEST_PRACTICES.md    # Clean Code, TS, erros (funcional vs técnico), testes, git
├── SKILLS.md            # Mapa do pipeline de skills por fase
├── .claude/
│   ├── commands/        # Slash-commands (deploy-*, uat) como templates
│   └── skills/          # mvp-development, post-mvp-development (gerais)
├── docs/
│   ├── adr/             # 000-template.md (Architecture Decision Records)
│   ├── guides/          # zod, testing, error-handling
│   └── superpowers/
│       ├── specs/        # _TEMPLATE.md
│       └── plans/        # _TEMPLATE.md
├── hooks/               # check-dependencies, git-freshness (SessionStart)
├── eslint.config.mjs    # flat config auto-contido (typescript-eslint)
├── tsconfig.json        # TS estrito, sem framework
├── vitest.config.ts     # unit/integration
├── .prettierrc          # formatação
├── .env.local.example   # placeholders genéricos (nunca versione segredos)
└── package.json         # apenas devDeps de tooling
```

## Como usar

1. **Clone/copie** este template para o seu novo projeto e renomeie.
2. **Instale as skills**: `/plugin install superpowers@claude-plugins-official`.
3. **Preencha a stack concreta** em `CLAUDE.md` e `ARCHITECTURE.md` (banco, auth,
   hospedagem) e registre as decisões como **ADRs** (`docs/adr/`).
4. `npm install` para o tooling; use `npm run lint`, `npm run type-check`,
   `npm test`, `npm run format`.
5. Ao adicionar o app — **web** (ex.: Next.js) ou **nativo iOS** (Expo/React
   Native) — inclua as deps de runtime e estenda os configs (eslint/tsconfig)
   para o framework. Os padrões de app nativo estão em `ARCHITECTURE.md`
   (seção *"Padrões para App Nativo"*) e `BEST_PRACTICES.md`.

## O pipeline

```
brainstorming → writing-plans → [mvp-development | post-mvp-development] → verification-before-completion
```

Features novas começam pelo **brainstorming** (produz a spec). Bugs vão direto
para **systematic-debugging**. Ver `SKILLS.md` e `CLAUDE.md`.

## Filosofia

Qualidade > velocidade. Comece **simples (MVP)** e evolua para **Clean
Architecture (Pós-MVP)** quando a complexidade justificar — nunca antes (YAGNI).
