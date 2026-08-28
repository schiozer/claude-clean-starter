# 007. Tooling da raiz isolado de exemplos autocontidos

**Data**: 2026-08-27
**Status**: Aceito

## Contexto

O repositório é um **template**: a raiz tem seu próprio tooling
(`eslint`/`tsc`/`vitest`) para validar os arquivos da própria raiz. Em paralelo,
`examples/` hospeda **projetos autocontidos** (ex.: `examples/walking-skeleton/`)
— cada um com seu `package.json`, lockfile, configs e stack próprios (o exemplo
usa Next.js/React; a raiz não trava stack).

Ao adicionar o primeiro exemplo, o job `Test & Lint (root)` quebrou. Três causas:

1. **O tooling da raiz varria `examples/`.** `eslint .`, `tsc` (`include: **/*.ts`)
   e a descoberta do `vitest` entravam no exemplo, colhendo configs/versões
   conflitantes (dois `node_modules`, tipos incompatíveis) e **artefatos gerados**
   (`.next/`) — milhares de erros de lint e falha de type-check.
2. **Faltava `package-lock.json` na raiz** → `npm ci` do CI quebrava.
3. **Faltava `@types/node`** na raiz → `vitest.config.ts` (usa `path`/`__dirname`,
   builtins do Node) quebrava o `tsc`.

O exemplo **já tem** seu próprio job de CI (`example`, com `working-directory`),
então validá-lo também pela raiz é redundante além de quebrado.

## Decisão

- **Cada projeto se valida.** Todo diretório em `examples/` é autocontido e é
  validado exclusivamente pelo **seu próprio job de CI** (padrão: um job por
  exemplo, com `working-directory`), usando o `package.json`/lockfile/configs
  dele.
- **O tooling da raiz ignora `examples/`:**
  - `eslint.config.mjs` → `ignores: ['examples/**', ...]`
  - `tsconfig.json` → `exclude: ['node_modules', 'examples']`
  - `vitest.config.ts` → `test.exclude: [..., 'examples/**']`
- **A raiz é um projeto Node real e roda de fato no CI:** mantém
  `package-lock.json` versionado (para `npm ci`) e `@types/node` como devDep
  (arquivos de config em TS usam builtins do Node). O job da raiz **não** tenta
  se auto-desligar por "ausência de projeto" — a raiz sempre tem o que validar.
- **Ao adicionar um novo exemplo:** crie o job de CI próprio dele; **não** relaxe
  as exclusões da raiz para "cobrir" o exemplo.

## Consequências

- **Prós:** CI da raiz estável e rápido; exemplos evoluem stack/versões de forma
  independente sem quebrar a raiz; fronteira nítida ("cada projeto se valida");
  artefatos gerados de um exemplo nunca contaminam o lint/type-check da raiz.
- **Contras / dívidas:** cada novo exemplo exige o próprio job de CI (setup
  repetido); as exclusões vivem em **três** configs da raiz — ao adotar uma nova
  ferramenta na raiz, lembre de excluir `examples/` nela também.

## Alternativas Consideradas

- **Monorepo com workspaces cobrindo tudo com um tooling só** — acopla versões e
  configs de todos os exemplos entre si e com a raiz, contrariando o princípio de
  "exemplo autocontido" e dificultando exemplos com stacks divergentes.
- **Tooling da raiz também lintando/testando `examples/`** — reintroduz os
  conflitos de config/versão e a coleta de artefatos gerados; além de redundante
  com o job dedicado de cada exemplo.
- **Job da raiz que se auto-desliga quando "não há projeto Node"** — tentado e
  revertido: parte de premissa falsa (a raiz TEM `package.json`), então nunca
  pulava e mascarava o problema real (lockfile + exclusões) em vez de resolvê-lo.
