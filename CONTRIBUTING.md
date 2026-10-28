# Contribuindo

Este é um **template**. Ao usá-lo em um projeto real, adapte estas diretrizes ao
seu contexto.

## Fluxo

1. Leia `CLAUDE.md`, `ARCHITECTURE.md` e `BEST_PRACTICES.md`.
2. Feature nova → skill `brainstorming` (spec) → `writing-plans` (plano) →
   implementação (TDD) → `verification-before-completion`.
3. Bug → skill `systematic-debugging` (causa-raiz antes da correção).

## Padrões

- Commits: `tipo(escopo): mensagem` (imperativo, minúsculo, ≤72 chars).
- Branches: `tipo/descrição-curta`.
- TypeScript sem `any`; validação com Zod; erros tratados (funcional vs técnico).

## Antes de abrir PR

- [ ] `npm run lint` sem warnings
- [ ] `npm run type-check` ok
- [ ] `npm test` passando
- [ ] Sem `console.log`/`debugger`; sem segredos versionados
- [ ] Documentação/ADR atualizados quando a decisão for relevante

## Template de PR e releases

Use o template do PR (`Spec:`, tabela `Spec × código`, checklist). O UAT é marcado só pelo humano.
O merge é _squash_ e o **título do PR** (`tipo(escopo): mensagem`) define a versão; as Releases do
GitHub são o CHANGELOG. O gate opcional com Claude depende de `SPEC_GATE` (runbook `spec-gate.md`).
Ver ADR-014.

## Melhorias vindas de projetos derivados

Uma melhoria feita num projeto derivado volta ao template por PR com `/template-sync contribuir`,
generalizada e sem nomes de projeto, conta ou segredo. Ver
[ADR-015](./docs/adr/template/015-template-sync.md).

## Conta git

Se você usa múltiplas contas git na mesma máquina, confira a conta ativa **antes**
de qualquer push/merge/PR (ver regra 5 do `CLAUDE.md`).

## Proteção da `main`

A `main` só recebe mudanças via PR (regra 0 do `CLAUDE.md`, ADR-005), para agente **e** humano.
O `npm install` instala a trava (git hooks de `.githooks/` via `core.hooksPath`); ela recusa
commit, merge, rebase etc. na `main` local e qualquer push para a `main`. Se barrar, crie uma
branch (`git switch -c tipo/descrição-curta`), commite, dê push e abra o PR; o merge é sempre do
humano. Em repositório novo, o primeiro push da `main` (remoto vazio) é liberado; depois, só por PR.
Para atualizar a `main` local use `git pull --ff-only`. Um workflow no GitHub
(`Guarda da main`) alarma se algum commit chegar à `main` sem PR.
