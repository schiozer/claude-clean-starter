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
│   ├── guides/          # zod, testing, e2e, error-handling, deploy-ci, mcp
│   ├── runbooks/        # operação por agentes: deploy, envs, flags, MCP, rollback (ADR-013)
│   └── superpowers/
│       ├── specs/        # _TEMPLATE.md
│       └── plans/        # _TEMPLATE.md
├── scripts/             # check-runbooks.mjs, check-cenarios.mjs, e2e/ (rastreabilidade e regressão)
├── tests/e2e/           # support/ e baseline/ (Playwright; cenários da spec, ADR-016)
├── .githooks/           # trava da main (reference-transaction, pre-push), ativada por `npm install`
├── hooks/               # check-dependencies, git-freshness (SessionStart); protect-main (PreToolUse)
├── eslint.config.mjs    # flat config auto-contido (typescript-eslint)
├── tsconfig.json        # TS estrito, sem framework
├── vitest.config.ts     # unit/integration
├── .prettierrc          # formatação
├── .env.local.example   # placeholders genéricos (nunca versione segredos)
└── package.json         # apenas devDeps de tooling
```

## Como usar

1. **Clone/copie** este template para o seu novo projeto e renomeie. Num repositório novo,
   faça `git push -u origin main` logo após o commit inicial; daí em diante a `main` só por PR.
2. **Instale as skills**: `/plugin install superpowers@claude-plugins-official`.
3. **Preencha a stack concreta** em `CLAUDE.md` e `ARCHITECTURE.md` (banco, auth,
   hospedagem) e registre as decisões como **ADRs** (`docs/adr/`).
4. **Declare o perfil arquitetural** no topo do `CLAUDE.md` (`mvp-primeiro` ou `completo-direto`).
5. **Complete os runbooks** de `docs/runbooks/` (todo `<preencher>`, data de verificação)
   e troque o CI para `npm run check:runbooks -- --strict` — ver ADR-013.
6. **Node ≥ 20** (os hooks em `hooks/` rodam com `node`); `npm install` para o tooling; use `npm run lint`, `npm run type-check`,
   `npm test`, `npm run check:runbooks`, `npm run format`; E2E com `npm run test:e2e`
   (Playwright), `npm run check:cenarios` (cenários × testes) e `npm run docs:gerar` (ajuda dos
   cenários `@doc`, só contra o app local) — ver o [guia de E2E](./docs/guides/e2e-guide.md).
7. Ao adicionar o app — **web** (ex.: Next.js) ou **nativo iOS** (Expo/React
   Native) — inclua as deps de runtime e estenda os configs (eslint/tsconfig)
   para o framework. Os padrões de app nativo estão em `ARCHITECTURE.md`
   (seção _"Padrões para App Nativo"_) e `BEST_PRACTICES.md`.

## Proteção da `main`

`npm install` ativa (via `core.hooksPath=.githooks`) git hooks que recusam commit/merge/rebase
na `main` local e qualquer push para a `main`; o workflow `Guarda da main` alarma no GitHub se
um commit chegar sem PR. Se a trava barrar, crie uma branch e abra um PR; para atualizar a
`main` local use `git pull --ff-only`. Detalhes no ADR-005.

## Releases e gates de PR

O PR usa `.github/pull_request_template.md` (`Spec:`, tabela `Spec × código`, UAT marcado só pelo
humano), validado pelo `PR gate`. O merge é _squash_; o título do PR define a versão SemVer, e a
cada merge sai uma tag `vX.Y.Z` e uma GitHub Release (o CHANGELOG). O gate opcional `Spec × código`
com Claude liga com `SPEC_GATE` (runbook `docs/runbooks/spec-gate.md`). Ver ADR-014.

## Testes E2E, regressão e ajuda

Os cenários de teste nascem na spec (revisados pela QA) e viram testes Playwright ligados pelo ID.
Todo PR roda o check obrigatório `Regressão (UAT)` (app local no template; Preview da Vercel no
projeto, runbook `docs/runbooks/e2e-uat-configurar.md`), e os cenários `@doc` geram a ajuda em
`/ajuda`. Ver [ADR-016](./docs/adr/template/016-testes-e2e-nascidos-da-spec.md). Os cenários
`@demo`/`@treinamento` viram vídeos gravados pelo Playwright depois de cada Release e publicados no
Bunny (`npm run demos:gravar`, toggle `DEMOS_BUNNY`, runbook `docs/runbooks/bunny-habilitar.md`) —
ver [ADR-017](./docs/adr/template/017-bunny-videos-demos-treinamento.md).

## Sync com o template

Projetos criados a partir deste template recebem as novidades de cada Release por PR com a skill
`template-sync` (`/template-sync adotar` na primeira vez, `/template-sync` depois), sem perder o
que mudaram. Ver [ADR-015](./docs/adr/template/015-template-sync.md).

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
