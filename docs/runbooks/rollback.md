# Runbook: Rollback (resposta a incidente)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT, Prod

## Objetivo

Primeira resposta a um incidente depois de um deploy, **do menos ao mais invasivo**:
desligar a flag da feature → promover o deploy anterior → reverter o código por PR. Banco
não volta por aqui: migração é sempre aditiva e o reverso é uma nova migração
([migracao-banco.md](./migracao-banco.md)).

## Pré-condições

- Incidente identificado (erro, regressão) e ambiente afetado conhecido.
- Em Prod, o humano está disponível para aprovar os passos R2.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir o scope Vercel: `vercel project ls --scope <preencher: team Vercel>` lista `<preencher: projeto Vercel>`.
3. [R0] Identificar o deploy atual e o anterior saudável: `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>` (UAT: `vercel alias ls`).

## Passos

1. [R0] Diagnosticar: `vercel logs <deploy-url> --scope <preencher: team Vercel>` e o PR/commit do deploy suspeito.
   Verificar: a feature/commit suspeito está identificado (ex.: erros só em `/api/<ctx>`).
2. [R2] Desligar a feature pelo kill switch `<CTX>_ENABLED=off` no ambiente afetado, via [feature-flags.md](./feature-flags.md) (em UAT é R1; desliga também as tools MCP da feature).
   Verificar: `/api/<ctx>` responde `404` e o erro parou nos logs. Resolveu → ir para a Verificação final.
3. [R2] Promover o deploy anterior saudável: `vercel rollback <deploy-anterior> --scope <preencher: team Vercel>` (UAT: reapontar o alias, R1, como no [deploy-uat.md](./deploy-uat.md)).
   Verificar: `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>` mostra o deploy anterior servindo e o smoke test passa.
4. [R1] Abrir o PR de revert: `git switch -c revert/<sha> origin/main && git revert <sha> && git push -u origin revert/<sha> && gh pr create --base main --fill`.
   Verificar: `gh pr checks <n> --watch` verde.
5. [R3] Humano: fazer o merge do PR de revert na `main` e avisar quando terminar.
   Verificar: `gh pr view <n> --json state` → `MERGED` e o novo deploy de Prod fica `Ready`.

## Verificação final

- Smoke test do ambiente ok (`200` na home, `401` em `/api/mcp` sem token) e logs sem o erro.
- Incidente comunicado ao humano com causa provável e o que foi feito.

## Rollback

1. [R2] Se a promoção piorou o cenário, voltar ao deploy anotado no pre-flight: `vercel promote <deploy-atual> --scope <preencher: team Vercel>`.
   Verificar: `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>` mostra `<deploy-atual>` servindo Prod.
2. [R2] Religar a flag desligada no passo 2 (valor anterior), via [feature-flags.md](./feature-flags.md).
   Verificar: `vercel env ls production --scope <preencher: team Vercel>` mostra o nome da flag e a rota volta ao comportamento anterior.

## Registro

Issue com label `ops` (`gh issue create --label ops --title "incidente: <resumo>" --body-file <arquivo>`)
e comentário no PR causador: runbook + `Última verificação`, linha do tempo, aprovações R2,
passos R3, resultado final (`ok` | `rollback` | `interrompido`).
