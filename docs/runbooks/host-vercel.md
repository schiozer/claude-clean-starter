# Runbook: Host Vercel (bootstrap, UAT, Prod, rollback, envs, cron, encerrar)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

## Objetivo

Operações do host **Vercel** da camada de deploy ([ADR-002](../adr/template/002-estrategia-de-ambientes.md)):
vale quando o `deploy.config.json` tem `"host": "vercel"` ou não existe (o padrão). Os runbooks
gerais ([bootstrap-ambientes.md](./bootstrap-ambientes.md), [deploy-uat.md](./deploy-uat.md),
[deploy-prod.md](./deploy-prod.md), [rollback.md](./rollback.md),
[segredos-e-env.md](./segredos-e-env.md), [feature-flags.md](./feature-flags.md)) mantêm o roteiro e
chamam os blocos abaixo — **Bootstrap**, **Bootstrap (pós-envs)**, **UAT**, **Prod**, **Rollback**,
**Segredos e envs**,
**Cron** e **Encerrar**. Execute o bloco que o runbook geral indicar, com o mesmo risco.

O [bootstrap-ambientes.md](./bootstrap-ambientes.md) chama o **Bootstrap** no passo 1 (só a
infraestrutura do host) e o **Bootstrap (pós-envs)** depois de Neon, Auth0, envs e UAT fixo — os
passos que dependem deles.

Na Vercel: integração Git da Vercel (Preview por PR, Production no merge da `main`), alias estável
de UAT apontado para o preview em aceite, Deployment Protection com bypass para o E2E e
`vercel rollback`/`promote` em Prod. O `deploy.yml` é no-op neste host.

## Pré-condições

- CLI `vercel` autenticada pelo humano (o agente não faz login por ninguém).
- Humano com admin no team Vercel `<preencher: team Vercel>`.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir o team Vercel: `vercel teams ls` inclui `<preencher: team Vercel>`.
3. [R0] Conferir o scope Vercel: `vercel project ls --scope <preencher: team Vercel>` lista `<preencher: projeto Vercel>` (no Bootstrap, o projeto ainda não existe: só o passo 2 vale).

## Passos

### Bootstrap

1. [R2] Criar o projeto Vercel ligado ao repo: `vercel link --project <preencher: projeto Vercel> --scope <preencher: team Vercel>` e conectar o Git no dashboard (Settings → Git).
   Verificar: `vercel project ls --scope <preencher: team Vercel>` lista o projeto e um push numa branch gera preview.

### Bootstrap (pós-envs)

Depende do tenant Auth0 de UAT, das envs e do alias do UAT (passos 5–8 do bootstrap-ambientes.md).

2. [R2] No app de login web do Auth0 de UAT, aceitar as URLs de Preview (callback `/api/auth/callback` e logout): `<preencher: padrão das URLs de Preview do projeto>`. O curinga do Auth0 vale só no rótulo mais à esquerda e com prefixo/sufixo; `vercel.app` é domínio compartilhado, então use prefixo **e** sufixo do projeto/team (ou um domínio próprio para os previews). O alias do UAT e o domínio de Prod entram sem curinga, cada um no tenant do seu ambiente.
   Verificar: o login pelo Universal Login funciona na URL de um preview e no alias do UAT.
3. [R3] Humano: configurar a _Deployment Protection_ da Vercel para o alias do UAT ser acessível no aceite e pelo ChatGPT (exceção para o alias, ou _Protection Bypass_ — ao menos `/api/mcp` e `/.well-known/*`).
   Verificar: `curl -s -o /dev/null -w '%{http_code}' https://<preencher: alias UAT>/` → `200` e `curl -si -X POST https://<preencher: alias UAT>/api/mcp | grep -i '^www-authenticate:.*resource_metadata'` encontra o header do app.

### UAT

4. [R0] Localizar o preview do PR: `vercel ls <preencher: projeto Vercel> --scope <preencher: team Vercel>` (ou o comentário do bot da Vercel no PR).
   Verificar: o deploy mais recente da branch está `Ready`; anotar a `<preview-url>`.
5. [R1] Apontar o alias estável do UAT para o preview: `vercel alias set <preview-url> <preencher: alias UAT, ex. projeto-uat.vercel.app> --scope <preencher: team Vercel>`.
   Verificar: `vercel alias ls --scope <preencher: team Vercel>` mostra o alias → `<preview-url>`.
6. [R1] Reverter: reapontar o alias do UAT para o preview anterior: `vercel alias set <preview-anterior> <preencher: alias UAT> --scope <preencher: team Vercel>`.
   Verificar: `vercel alias ls --scope <preencher: team Vercel>` mostra o alias → `<preview-anterior>` e a home responde `200`.

A URL do UAT deste host é `https://<preencher: alias UAT>`.

### Prod

**Com a esteira** ([ADR-020](../adr/template/020-esteira-integracao-e-promocao.md)): a `develop` é o
UAT (Preview restrito à `develop` ou Custom Environment `uat`, alias `vercel.uatAlias`); Prod sai do
**FF da `main`** feito pelo `promover.yml` ([promover-prod.md](./promover-prod.md)), e a Vercel
builda Production desse SHA (V1: mesmo commit, não mesmo pacote). O hotfix é o build de Production
do merge na `main` ([hotfix.md](./hotfix.md)). Os passos abaixo valem iguais com o SHA promovido no
lugar do `mergeCommit`.

7. [R0] Anotar o deploy de Prod atual (alvo do rollback): `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>`.
   Verificar: o deploy servindo Prod está `Ready`; anotar `<deploy-atual>`.
8. [R0] Acompanhar o deploy de Produção: `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>`.
   Verificar: o deploy do `mergeCommit` chega a `Ready` (`Error` → [rollback.md](./rollback.md)).
9. [R0] Conferir que o domínio de Prod serve **esse** deploy: `vercel inspect https://<preencher: domínio de Prod> --scope <preencher: team Vercel>`.
   Verificar: o deploy servido é o do `mergeCommit`. Se é outro, há um rollback instantâneo ativo (a atribuição automática do domínio fica desligada) → passo 10; senão, pular o passo 10.
10. [R2] Só com rollback ativo: promover o novo deploy, religando a atribuição automática: `vercel promote <deploy-do-mergeCommit> --scope <preencher: team Vercel>`.
    Verificar: `vercel inspect https://<preencher: domínio de Prod>` mostra o deploy do `mergeCommit`.
11. [R0] Observar erros por alguns minutos: `vercel logs <deploy-url> --scope <preencher: team Vercel>`.
    Verificar: sem pico de erros 5xx novos (havendo → [rollback.md](./rollback.md)).

A URL de Prod deste host é `https://<preencher: domínio de Prod>`.

### Rollback

**Com a esteira**: o smoke test falho da promoção já faz o rollback (`--yes`, no CI) e abre a issue
`esteira` "main à frente de Prod"; a correção segue por [hotfix.md](./hotfix.md) e o passo 14 vale
para o deploy do hotfix. Os passos abaixo são o rollback manual.

12. [R0] Identificar o deploy atual e o anterior saudável: `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>` (UAT: `vercel alias ls`) e diagnosticar com `vercel logs <deploy-url> --scope <preencher: team Vercel>`.
    Verificar: `<deploy-atual>` e `<deploy-anterior>` anotados; a feature/commit suspeito está identificado.
13. [R2] Promover o deploy anterior saudável: `vercel rollback <deploy-anterior> --scope <preencher: team Vercel>` (em UAT, use o passo 6, que reaponta o alias).
    Verificar: `vercel inspect https://<preencher: domínio de Prod> --scope <preencher: team Vercel>` mostra o deploy anterior servindo e o smoke test passa. Atenção: após `vercel rollback`, a Vercel **desliga a atribuição automática** do domínio — novos deploys de Prod não entram no ar até o passo 14.
14. [R2] Depois do merge do revert: promover o deploy do revert, religando a atribuição automática: `vercel promote <deploy-do-revert> --scope <preencher: team Vercel>`.
    Verificar: `vercel inspect https://<preencher: domínio de Prod>` mostra o deploy do commit de revert (sem isso, merges futuros não chegam a Prod).
15. [R2] Se a promoção piorou o cenário, voltar ao deploy anotado: `vercel promote <deploy-atual> --scope <preencher: team Vercel>`.
    Verificar: `vercel ls <preencher: projeto Vercel> --prod --scope <preencher: team Vercel>` mostra `<deploy-atual>` servindo Prod.

### Segredos e envs

Na Vercel, UAT = ambiente `preview` e Prod = `production`.

16. [R0] Listar as envs do ambiente (só nomes): `vercel env ls <preview|production> --scope <preencher: team Vercel>`.
    Verificar: a saída tem só nomes, ambientes e datas (nunca valores).
17. [R1] Env **não-secreta** no UAT: `printf '<valor>' | vercel env add <NOME> preview --scope <preencher: team Vercel>` (alterar = `vercel env rm <NOME> preview --yes` antes). Em `production` é **R2**. Flags: `vercel env rm <FLAG> preview --yes --scope <preencher: team Vercel>` e `printf 'on' | vercel env add <FLAG> preview --scope <preencher: team Vercel>` (ou `off`).
    Verificar: `vercel env ls preview --scope <preencher: team Vercel>` lista `<NOME>`.
18. [R2] **Segredo** (criar ou rotacionar, qualquer ambiente): o agente pede ao humano que rode, **num terminal separado, fora da sessão do agente** (ou pelo dashboard da Vercel), `vercel env rm <NOME> <ambiente> --yes` (se já existir) e `vercel env add <NOME> <ambiente>`, digitando o valor no prompt. Nunca pelo prefixo `!` da sessão: a saída cairia no contexto do agente. O agente não vê, não ecoa e não passa o valor em argumento.
    Verificar: `vercel env ls <ambiente> --scope <preencher: team Vercel>` lista `<NOME>` (a data de atualização mudou).
19. [R1] Redeploy para o valor valer: UAT `vercel redeploy <preview-url> --scope <preencher: team Vercel>` e reapontar o alias (passo 5); Prod `vercel redeploy <deploy-prod-url>` é **R2**. O deploy em execução segue com o valor antigo até aqui.
    Verificar: o novo deploy fica `Ready` em `vercel ls <preencher: projeto Vercel> --scope <preencher: team Vercel>` e o smoke test do ambiente passa.
20. [R1] Remover uma env não-secreta do UAT (reverso do passo 17): `vercel env rm <NOME> preview --yes --scope <preencher: team Vercel>`; em Prod é **R2**. Depois, redeploy (passo 19).
    Verificar: `vercel env ls preview --scope <preencher: team Vercel>` não lista mais `<NOME>`.

Proibido (R3): `vercel env pull` para stdout ou para arquivo que o agente leia.

### Cron

21. [R1] Declarar o job no `vercel.json` do projeto (`"crons": [{ "path": "/api/cron/<job>", "schedule": "<preencher: expressão cron>" }]`) por PR; a rota valida `CRON_SECRET` (segredo, passo 18). A Vercel Cron só dispara em Production, então o job entra no ar com o merge.
    Verificar: depois do merge, o dashboard (Settings → Cron Jobs) lista o job e `vercel logs` mostra a chamada no horário.

### Encerrar

22. [R2] Desmontar o projeto, do último recurso para o primeiro, um por aprovação (destrutivo): `vercel alias rm <preencher: alias UAT> --scope <preencher: team Vercel>`, `vercel env rm <NOME> <ambiente> --yes --scope <preencher: team Vercel>`, `vercel project rm <preencher: projeto Vercel> --scope <preencher: team Vercel>`.
    Verificar: `vercel project ls --scope <preencher: team Vercel>` não lista mais o projeto.

## Verificação final

- O bloco executado terminou com todos os `Verificar:` ok e o runbook geral que o chamou seguiu.
- Bootstrap: projeto ligado ao repo, alias do UAT acessível sem a Deployment Protection bloquear `/api/mcp`.

## Rollback

1. [R1] Desfazer o passo de UAT executado: reapontar o alias para o preview anterior (passo 6).
   Verificar: `vercel alias ls --scope <preencher: team Vercel>` mostra o alias → `<preview-anterior>`.
2. [R2] Desfazer o Bootstrap: bloco **Encerrar** (passo 22), um recurso por aprovação; Prod: bloco **Rollback**.
   Verificar: `vercel project ls --scope <preencher: team Vercel>` reflete o estado anterior.

## Registro

No runbook geral que chamou o bloco (comentário no PR ou issue `ops`): bloco e passos executados,
deploys/alias (URLs), aprovações R2, passos R3 feitos pelo humano. Nunca valores de segredo.
