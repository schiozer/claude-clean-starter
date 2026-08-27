# 005. Trunk-Based Development (Branching Git)

**Data**: 2026-08-27
**Status**: Aceito

## Contexto

[ADR-002](./002-estrategia-de-ambientes.md) define três ambientes (Dev / UAT /
Prod) e um fluxo de promoção. Falta fixar **a estratégia de branching Git** que
alimenta esse fluxo. A armadilha clássica é criar branches longevas por ambiente
(`develop`, `staging`, `production`): elas divergem, geram merges dolorosos e
fazem "o que está em cada ambiente" virar um mistério.

Forças:

1. **Integração contínua** — quanto mais tempo o código fica fora da trunk, mais
   caro o merge e maior o risco.
2. **Promoção previsível** — o que vai para UAT e Prod deve ser rastreável a um
   commit único da trunk (ADR-002).
3. **Trabalho incompleto** — precisa poder ir para a trunk sem ativar para o
   usuário.

## Decisão

**Trunk-Based Development, sempre. Uma única trunk (`main`), sempre integrável e
deployável. Nada de branches longevas por ambiente.**

- **Todo merge na `main` é via Pull Request — SEMPRE, sem exceção.** Nunca há
  push direto na trunk; qualquer mudança (código, docs, ADRs) passa por PR.
- **Feature branches curtas** (horas a 1–2 dias), com merge frequente na `main`
  **via PR**.
- **CI dirigido por PR**: **abrir/atualizar um PR dispara deploy em UAT**;
  **o merge na `main` (após aprovação do UAT) dispara deploy em Prod**. O ambiente
  é resultado de **onde um commit foi promovido**, não de qual branch ele vive.
  Ver o fluxo em [ADR-002](./002-estrategia-de-ambientes.md).
- **Sem** `develop` / `staging` / `production` como branches de longa duração.
- **Trabalho incompleto fica atrás de feature flags**, não de branch — permite
  integrar cedo sem expor ao usuário.
- A `main` deve passar em type-check, lint e testes antes do merge (ver
  `BEST_PRACTICES.md`).

## Consequências

**Fica mais fácil**
- Merges pequenos e frequentes; menos conflitos e menos "big bang".
- Rastreabilidade: cada ambiente aponta para um commit concreto da trunk.
- Alinhamento direto com o fluxo de promoção do ADR-002.

**Fica mais difícil / dívidas assumidas**
- Exige **feature flags** e disciplina para manter a `main` sempre verde.
- Cobertura de testes automatizados passa a ser pré-requisito, não opcional.
- Mudança cultural para quem vem de GitFlow.

## Alternativas Consideradas

- **GitFlow (branches por ambiente/release)** — descartado: branches longevas
  divergem, os merges doem e contradizem a promoção por commit do ADR-002.
- **GitHub Flow (feature branch → PR → main)** — muito próximo desta decisão; na
  prática esta ADR **é** GitHub Flow reforçado com trunk sempre deployável +
  feature flags. Adotado como forma explícita de trunk-based.
