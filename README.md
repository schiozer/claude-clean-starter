# claude-clean-starter

Template de **disciplina + esteira** para projetos assistidos pelo Claude
(Claudinho). **Não é uma aplicação** — não traz `src/` de produto nem trava uma
stack. Ele reúne o que é **geral e reutilizável**: direção arquitetural, boas
práticas, o pipeline de skills (superpowers) e o tooling de qualidade.

## O que vem dentro

```
.
├── CLAUDE.md            # Instruções para o agente (regras, pipeline, persona Claudinho)
├── ARCHITECTURE.md      # Módulos por contexto, Service Layer, DDD tático, borda MCP
├── BEST_PRACTICES.md    # Clean Code, TS, erros (funcional vs técnico), testes, git
├── SKILLS.md            # Mapa do pipeline de skills por fase
├── .claude/
│   ├── commands/        # Slash-commands (deploy-*, uat) como templates
│   └── skills/          # mvp-development, ddd-service-development, runbook-execution
├── docs/
│   ├── adr/             # 000-template.md (Architecture Decision Records)
│   ├── guides/          # zod, testing, error-handling, deploy-ci, mcp
│   ├── runbooks/        # operação por agentes: deploy, envs, flags, MCP, rollback (ADR-013)
│   └── superpowers/
│       ├── specs/        # _TEMPLATE.md
│       └── plans/        # _TEMPLATE.md
├── scripts/             # check-runbooks.mjs (npm run check:runbooks)
├── hooks/               # check-dependencies, git-freshness (SessionStart); protect-main (PreToolUse)
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
4. **Declare o perfil arquitetural** no topo do `CLAUDE.md` (`mvp-primeiro` ou `completo-direto`).
5. **Complete os runbooks** de `docs/runbooks/` (todo `<preencher>`, data de verificação)
   e troque o CI para `npm run check:runbooks -- --strict` — ver ADR-013.
6. **Node ≥ 20** (os hooks em `hooks/` rodam com `node`); `npm install` para o tooling; use `npm run lint`, `npm run type-check`,
   `npm test`, `npm run check:runbooks`, `npm run format`.
7. Ao adicionar o app — **web** (ex.: Next.js) ou **nativo iOS** (Expo/React
   Native) — inclua as deps de runtime e estenda os configs (eslint/tsconfig)
   para o framework. Os padrões de app nativo estão em `ARCHITECTURE.md`
   (seção *"Padrões para App Nativo"*) e `BEST_PRACTICES.md`.

## O pipeline

```
brainstorming → writing-plans → [mvp-development | ddd-service-development] (conforme o perfil) → verification-before-completion
```

Features novas começam pelo **brainstorming** (produz a spec). Bugs vão direto
para **systematic-debugging**. Ver `SKILLS.md` e `CLAUDE.md`.

## Filosofia

Qualidade > velocidade. Todo sistema nasce **agêntico**: a regra de negócio vive num
Service por contexto, e REST e **MCP** (para ChatGPT, Claude, Cursor…) são bordas finas
sobre ele. Projetos `mvp-primeiro` começam enxutos e evoluem para DDD tático quando a
complexidade justificar; projetos `completo-direto` já nascem completos.
