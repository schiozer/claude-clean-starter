# Runbook: Migração de banco (SQL versionado, ADR-008)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

## Objetivo

Aplicar uma migração `drizzle/NNNN_nome.sql` com o aplicador do projeto
([ADR-008](../adr/008-migracoes-sql-versionadas-driver-http.md)), na ordem preview/Dev → UAT →
Prod. Migração é **aditiva** e vai a Prod **antes do merge** do PR que a usa.
`drizzle-kit push` é **proibido**. Não há rollback automático: o reverso é uma nova
migração ou a restauração do branch de backup.

## Pré-condições

- Arquivo `drizzle/NNNN_nome.sql` revisado no PR (aditivo: `ADD COLUMN` com default/nullable, `CREATE TABLE`, `CREATE INDEX CONCURRENTLY`…).
- Arquivos de env por ambiente (`.env.dev`, `.env.uat`, `.env.prod`, com `DATABASE_URL`) **mantidos pelo humano**, fora do git. O agente passa o caminho ao aplicador e **nunca** os lê nem imprime.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir o projeto e os branches Neon: `neonctl branches list --project-id <preencher: id do projeto Neon>` mostra `main` (Prod), `uat`, `dev`.
3. [R0] Conferir que os arquivos de env existem sem lê-los: `test -f .env.uat && test -f .env.prod && echo ok`.

## Passos

1. [R1] Aplicar no Dev: `node scripts/apply-migration.mjs drizzle/NNNN_nome.sql --env .env.dev`.
   Verificar: saída do aplicador sem erro e a mudança visível (`neonctl` → SQL Editor ou `information_schema.columns` filtrando a tabela).
2. [R1] Aplicar no UAT: `node scripts/apply-migration.mjs drizzle/NNNN_nome.sql --env .env.uat`.
   Verificar: idem, no branch `uat`; o UAT (alias, branch `uat`) funciona com o schema novo.
3. [R2] Criar o branch de backup de Prod: `neonctl branches create --name backup-<AAAA-MM-DD>-NNNN --parent main --project-id <preencher: id do projeto Neon>`.
   Verificar: `neonctl branches list --project-id <preencher: id do projeto Neon>` mostra o backup.
4. [R2] Aplicar em Prod (antes do merge): `node scripts/apply-migration.mjs drizzle/NNNN_nome.sql --env .env.prod`.
   Verificar: saída sem erro e a mudança visível no branch `main`; o deploy de Prod atual continua saudável (a migração é aditiva).

## Verificação final

- Schema igual em Dev, UAT e Prod para esta migração; Prod saudável; PR pronto para o [deploy-prod.md](./deploy-prod.md).

## Rollback

1. [R1] Dev/UAT: aplicar a migração inversa (`drizzle/NNNN+1_reverte_nome.sql`, revisada no PR). Nunca `neonctl branches reset … --parent` no `uat`/`dev`: o pai é `main` e o reset copiaria dados de Prod.
   Verificar: o schema voltou ao estado anterior no branch.
2. [R2] Prod: preferir a migração inversa aditiva por PR; em dano de dados, restaurar do backup: `neonctl branches restore main backup-<AAAA-MM-DD>-NNNN --project-id <preencher: id do projeto Neon>` (ou point-in-time: `main@<timestamp>`).
   Verificar: dados/schema conferidos no branch `main` e Prod saudável.

## Registro

Comentário no PR da migração (`gh pr comment <n> --body-file <arquivo>`): arquivo SQL,
ambientes aplicados com resultado, branch de backup, aprovações R2, resultado final. Nunca
inclua `DATABASE_URL`.
