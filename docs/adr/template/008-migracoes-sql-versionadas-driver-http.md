# 008. Migrações SQL versionadas aplicadas pelo driver HTTP

**Data**: 2026-09-06
**Status**: Aceito

## Contexto

[ADR-001](./001-neon-auth0.md) fixou **Neon** (Postgres serverless) via driver HTTP
(`@neondatabase/serverless`), e [ADR-003](./003-banco-por-ambiente-neon.md) definiu
que migrations são promovidas branch a branch (dev → uat → prod). Falta decidir
**como** uma migration é escrita e aplicada — a mecânica que, se errada, corrompe
schema ou derruba produção.

Forças aprendidas em uso real:

1. **O comando de "push" do ORM recria tabelas.** `drizzle-kit push` (e equivalentes)
   compara o schema do código com o banco e aplica um diff automático. No driver
   **websocket** ele trava neste ambiente serverless; e mesmo funcionando, o diff
   automático pode **recriar tabelas** (perda de dados) em vez de fazer a alteração
   incremental que você quer. Diff automático é conveniente e imprevisível.
2. **`main` faz auto-deploy para produção** ([ADR-005](./005-trunk-based-development.md),
   [ADR-006](./006-processo-de-feature-e-feature-toggle.md)). Um merge que adiciona uma
   coluna e o código que a lê sobem **juntos** — se o banco de prod ainda não tem a
   coluna, o deploy quebra no ar.
3. **Reprodutibilidade e revisão.** Uma alteração de schema precisa ser lida no PR,
   versionada, e reaplicável de forma idêntica nos três ambientes.

## Decisão

**Migrations são arquivos SQL escritos à mão, versionados, e aplicados por um script
próprio sobre o driver HTTP — nunca por `push`/diff automático do ORM.**

- **Arquivos numerados e versionados** em `drizzle/NNNN_nome.sql` (`0000_…`,
  `0001_…`), commitados junto ao PR que os usa. A ordem é o número.
- **Um aplicador próprio** (`scripts/apply-migration.mjs`) roda o SQL pelo driver
  **HTTP** do Neon, por ambiente:
  ```bash
  node scripts/apply-migration.mjs drizzle/0007_add_col.sql --env .env.uat
  node scripts/apply-migration.mjs drizzle/0007_add_col.sql --env .env.prod
  ```
- **`drizzle-kit push` é proibido** como caminho de migration. O schema Drizzle no
  código descreve os tipos; a **fonte da verdade da mudança** é o arquivo SQL.
- **Migration de schema aditiva (nova coluna/tabela) vai para Prod ANTES do merge.**
  Como `main` auto-deploya, a sequência é: aplicar em prod → só então mergear o PR que
  lê a coluna. Nunca o inverso.

## Consequências

**Fica mais fácil**
- Previsibilidade: você lê exatamente o SQL que vai rodar; nada de diff mágico.
- Revisão: a mudança de schema é um arquivo no diff do PR.
- Isolamento com IA/MCP: o mesmo SQL roda num branch efêmero do Neon
  ([ADR-003](./003-banco-por-ambiente-neon.md)) para ensaio destrutivo e descarte.

**Fica mais difícil / dívidas assumidas**
- Escrever SQL à mão é mais trabalhoso que gerar o diff — troca conveniência por
  controle (aceitável e desejado).
- Disciplina humana: lembrar de aplicar em prod **antes** do merge é um passo
  fora do código, fácil de esquecer. Mitiga-se com checklist de PR e este ADR.
- Sem rollback automático: reverter é escrever a migration inversa.

## Alternativas Consideradas

- **`drizzle-kit push` (diff automático).** Descartado: trava no driver serverless e
  arrisca recriar tabelas; diff implícito é ruim para revisão e para produção.
- **Framework de migrations com "up/down" gerado.** Mais cerimônia e outra dependência;
  o par "arquivo SQL numerado + aplicador HTTP" cobre o caso com menos peças.
- **Aplicar migration depois do merge.** Descartado: com auto-deploy de `main`, isso
  garante uma janela de produção quebrada entre o merge e a migration.
</content>
