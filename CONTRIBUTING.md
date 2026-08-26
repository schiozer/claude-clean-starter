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
