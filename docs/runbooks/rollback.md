# Runbook: Rollback (resposta a incidente)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT, Prod

## Objetivo

Primeira resposta a um incidente depois de um deploy, **do menos ao mais invasivo**:
desligar a flag da feature → promover o deploy anterior → reverter o código por PR. Banco
não volta por aqui: migração é sempre aditiva e o reverso é uma nova migração
([migracao-banco.md](./migracao-banco.md)). Os passos de host chamam os blocos do runbook do host do
`deploy.config.json` ([host-vercel.md](./host-vercel.md), [host-heroku.md](./host-heroku.md),
[host-cloudrun.md](./host-cloudrun.md)).

**Com a esteira** ([ADR-020](../adr/template/020-esteira-integracao-e-promocao.md)): o smoke test
falho da promoção já faz `rollbackProd` sozinho ([promover-prod.md](./promover-prod.md)); este
runbook é para o incidente depois. O revert (passos 4–5) vai pela `develop` e é promovido; se for
urgente, é um PR `hotfix/revert-<sha>` com base `main` ([hotfix.md](./hotfix.md)). O rollback
automático de cada host:

- **Heroku**: volta Prod para o `{slug}` da release anterior com o config **atual** do app (as
  config vars não voltam) — escolha registrada.
- **Cloud Run**: volta para a revisão que servia 100% antes do deploy (`payload.revisaoAnterior`
  do Deployment `production`); sem ela, para a revisão pronta mais nova anterior à atual. Com
  tráfego dividido, cai nessa regra determinística.
- **Vercel**: `vercel rollback --yes --scope <team>` (volta para o deploy de Prod anterior).

## Pré-condições

- Incidente identificado (erro, regressão) e ambiente afetado conhecido.
- Em Prod, o humano está disponível para aprovar os passos R2.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir a conta e o projeto do host: Pre-flight do runbook do host (host-<host>.md).
3. [R0] Identificar o deploy atual e o anterior saudável: bloco **Rollback** do runbook do host, passo de identificar (UAT: bloco **UAT**).

## Passos

1. [R0] Diagnosticar: os logs do bloco **Rollback** do runbook do host e o PR/commit do deploy suspeito.
   Verificar: a feature/commit suspeito está identificado (ex.: erros só em `/api/<ctx>`).
2. [R2] Desligar a feature pelo kill switch `<CTX>_ENABLED=off` no ambiente afetado, via [feature-flags.md](./feature-flags.md) (desliga também as tools MCP da feature).
   Verificar: `/api/<ctx>` responde `404` e o erro parou nos logs. Resolveu → ir para a Verificação final; não resolveu → passo 3 (é o fluxo previsto, **não** é falha que dispara o Rollback deste runbook).
3. [R2] Voltar Prod ao deploy anterior saudável: bloco **Rollback** do runbook do host (host-<host>.md) (em UAT, use o Rollback do [deploy-uat.md](./deploy-uat.md), que reaponta o UAT fixo).
   Verificar: os `Verificar:` do bloco mostram o deploy anterior servindo e o smoke test passa. Na Vercel, o rollback **desliga a atribuição automática** do domínio — novos deploys de Prod não entram no ar até o passo 6.
4. [R1] Abrir o PR de revert: `git fetch origin && git switch -c revert/<sha> origin/main && git revert <sha>` (commit de merge: `git revert -m 1 <sha>`) e `git push -u origin revert/<sha> && gh pr create --base main --fill`. Com a esteira: `revert/<sha>` a partir de `origin/develop` com `--base develop` (depois promover), ou `hotfix/revert-<sha>` a partir de `origin/main` com `--base main` ([hotfix.md](./hotfix.md)).
   Verificar: `gh pr checks <n> --watch` verde.
5. [R3] Humano: fazer o merge do PR de revert na `main` (com a esteira, na base do PR e, se for a `develop`, disparar a promoção) e avisar quando terminar.
   Verificar: `gh pr view <n> --json state` → `MERGED` e o deploy do commit de revert fica pronto (bloco **Prod** do runbook do host).
6. [R2] Só na Vercel, se o passo 3 foi executado e o domínio não serve o deploy do revert: passo de promover o deploy do revert do bloco **Rollback** do host-vercel.md (`promote`, que religa a atribuição automática). Nos demais hosts: não se aplica (no Heroku o auto-deploy e no Cloud Run o `--to-latest` do `deploy.yml` já põem o revert no ar).
   Verificar: o domínio de Prod serve o deploy do commit de revert (sem isso, merges futuros não chegam a Prod).

## Verificação final

- Smoke test do ambiente ok (`200` na home, `401` com `WWW-Authenticate` (`resource_metadata`) em `/api/mcp` sem token) e logs sem o erro.
- Incidente comunicado ao humano com causa provável e o que foi feito.

## Rollback

1. [R2] Se a promoção piorou o cenário, voltar ao deploy anotado no pre-flight: bloco **Rollback** do runbook do host, passo de voltar ao deploy anotado.
   Verificar: os `Verificar:` do bloco mostram `<deploy-atual>` servindo Prod.
2. [R2] Religar a flag desligada no passo 2 (valor anterior), via [feature-flags.md](./feature-flags.md).
   Verificar: a listagem de nomes do bloco **Segredos e envs** do runbook do host mostra a flag em Prod e a rota volta ao comportamento anterior.

## Registro

Issue com label `ops` (`gh issue create --label ops --title "incidente: <resumo>" --body-file <arquivo>`)
e comentário no PR causador: runbook + `Última verificação`, linha do tempo, aprovações R2,
passos R3, resultado final (`ok` | `rollback` | `interrompido`).
