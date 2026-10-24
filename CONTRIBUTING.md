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

## Conta git

Se você usa múltiplas contas git na mesma máquina, confira a conta ativa **antes**
de qualquer push/merge/PR (ver regra 5 do `CLAUDE.md`).

## Proteção da `main`

A `main` só recebe mudanças via PR (regra 0 do `CLAUDE.md`, ADR-005), para agente **e** humano.
O `npm install` instala a trava (git hooks de `.githooks/` via `core.hooksPath`); ela recusa
commit, merge, rebase etc. na `main` local e qualquer push para a `main`. Se barrar, crie uma
branch (`git switch -c tipo/descrição-curta`), commite, dê push e abra o PR; o merge é sempre do
humano. Para atualizar a `main` local use `git pull --ff-only`. Um workflow no GitHub
(`Guarda da main`) alarma se algum commit chegar à `main` sem PR.
