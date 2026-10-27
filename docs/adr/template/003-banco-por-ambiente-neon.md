# 003. Banco por Ambiente (Neon)

**Data**: 2026-08-27
**Status**: Aceito

## Contexto

[ADR-001](./001-neon-auth0.md) fixou **Neon** (Postgres serverless) como banco, e
[ADR-002](./002-estrategia-de-ambientes.md) exige que o banco exista nos três
ambientes (Dev / UAT / Prod) com paridade e isolamento. Falta decidir **como**
Neon materializa esses ambientes.

Forças:

1. **Isolamento** — dados de Dev/UAT não podem tocar Prod.
2. **Paridade** — mesmo Postgres/schema nos três ambientes.
3. **Workflow com IA/MCP** — o agente precisa rodar migrations destrutivas em
   isolamento e descartar sem risco (ADR-001).
4. **Simplicidade operacional** — evitar multiplicar projetos e credenciais.

## Decisão

**Um único projeto Neon para o app. Os ambientes são branches desse projeto.**

- **Prod** = branch principal (`main`/`prod`) do projeto Neon.
- **UAT** = branch `uat` do mesmo projeto.
- **Dev** = branch `dev` do mesmo projeto.
- **Branches efêmeros de dev/MCP** saem do branch `dev` (ou de `prod` quando se
  precisa de dados realistas), servem para experimentos e migrations destrutivas
  isoladas, e são **descartáveis**. Nunca viram ambiente permanente.

**Migrations** são promovidas branch a branch, acompanhando o fluxo de ambientes
de [ADR-002](./002-estrategia-de-ambientes.md): aplicadas e validadas em `dev` →
`uat` → `prod`. Cada branch tem sua própria connection string, exposta ao app via
os secrets por ambiente (ADR-002); a string **nunca** é commitada.

> Nota: "branch" aqui é **branch do Neon** (isolamento de banco por
> copy-on-write), não branch de Git. A regra "sem branches por ambiente" de
> [ADR-005](./005-trunk-based-development.md) vale para **Git**, não para o Neon.

## Consequências

**Fica mais fácil**
- Isolamento com paridade: todos os branches derivam do mesmo projeto/schema.
- Workflow com IA/MCP: branch efêmero para experimento destrutivo, verificar,
  descartar — sem risco a dados reais (ADR-001).
- Operação enxuta: um projeto, credenciais por branch.

**Fica mais difícil / dívidas assumidas**
- Disciplina de promoção de migrations entre branches (dev → uat → prod).
- Branches efêmeros precisam de rotina de limpeza para não acumular.
- Isolamento é lógico (mesmo projeto), não físico entre projetos distintos —
  aceitável dado o modelo de branching do Neon.

## Alternativas Consideradas

- **Um projeto Neon por ambiente** — isolamento físico total, porém mais
  credenciais, mais custo e pior ergonomia de branching entre ambientes.
  Descartado: o branching nativo do Neon já entrega isolamento suficiente com um
  projeto só.
- **Banco local (Docker) no Dev** — descartado por reduzir paridade com o Neon de
  Prod e obrigar a aplicar migrations em dois mundos diferentes.
