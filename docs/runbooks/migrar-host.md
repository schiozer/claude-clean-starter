# Runbook: Migrar o projeto de host (Vercel ↔ Heroku ↔ Cloud Run)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT, Prod

## Objetivo

Levar um projeto de um host da camada de deploy para outro (`host` do `deploy.config.json`:
`vercel` | `heroku` | `cloudrun`) sem janela de indisponibilidade. O host novo sobe **em paralelo**,
recebe as envs, vira o host do repositório por PR, é validado no UAT, recebe o corte de Prod
(DNS/domínio) e só então o host antigo é desmontado. Cada etapa usa os blocos dos runbooks de host:
[host-vercel.md](./host-vercel.md), [host-heroku.md](./host-heroku.md),
[host-cloudrun.md](./host-cloudrun.md).

**Fora deste runbook — é código do app** (cada item vira um PR próprio, antes do corte):

- `@vercel/node`, `@vercel/blob`, `@vercel/kv`, `@vercel/edge-config`, `@vercel/analytics`/`speed-insights` e outros SDKs que só funcionam (ou só fazem sentido) na Vercel;
- variáveis `VERCEL_*` lidas pelo app (`VERCEL`, `VERCEL_URL`, `VERCEL_ENV`, `VERCEL_GIT_*`…): nos outros hosts elas não existem (o equivalente é `DYNO`/`HEROKU_*` no Heroku e `K_SERVICE`/`K_REVISION` no Cloud Run). O app deve ler `APP_ENV` e as URLs públicas configuradas;
- `vercel.json` (crons, rewrites, headers) e `middleware`/rotas _edge_ que dependem do runtime da Vercel;
- arquivos de raiz do host novo (`Procfile` + `app.json`, ou `Dockerfile` + `.dockerignore` e `output: 'standalone'`), copiados pelo bloco **Bootstrap** do runbook do host.

## Pré-condições

- Host atual e host novo decididos pelo humano (e o porquê registrado num ADR do projeto).
- Os PRs de código do app (lista do Objetivo) já mergeados, e o app sobe localmente com `APP_ENV` sem depender de `VERCEL_*`.
- Lista das envs e segredos de cada ambiente (só nomes) tirada do host atual pelo bloco **Segredos e envs** dele.
- Humano disponível para os passos R2/R3 (DNS, Auth0, segredos, merge).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir o host atual: `node scripts/deploy/index.mjs host` (sem `deploy.config.json` = `vercel`) e o Pre-flight do runbook do host atual e do novo.
3. [R0] Conferir que a `main` está verde e sem PR de deploy em andamento: `gh pr list --repo <preencher: owner/repo> --state open`.

## Passos

1. [R2] Bootstrap do host novo **em paralelo**: bloco **Bootstrap** do runbook do host novo (projetos/apps, credenciais de CI, Auth0 de UAT). O host atual segue servindo UAT e Prod.
   Verificar: os `Verificar:` do bloco passam; o domínio de Prod continua no host atual.
2. [R2] Recriar as envs e os segredos no host novo, por ambiente: bloco **Segredos e envs** do runbook do host novo, com os nomes listados nas Pré-condições (o humano digita os valores; nada vem do host antigo para a sessão do agente). Inclui `APP_ENV`, `MCP_RESOURCE_URL` e as URLs públicas com os endereços do host novo.
   Verificar: a listagem de nomes do host novo bate com a do host atual, ambiente a ambiente.
3. [R1] Trocar o host do repositório por PR: `deploy.config.json` com o `host` novo (e o bloco dele), arquivos de raiz do host novo, e a remoção dos do host antigo que não servem mais; `npm run lint && npm test` locais. Se o host antigo é a Vercel, a integração Git dela continuaria criando previews: deixe-a ligada até o passo 7.
   Verificar: no PR, o job `Deploy` roda com o host novo e a `Regressão (UAT)` fica verde contra a URL do preview do host novo (comentário do bot com `alvo: https://…`).
4. [R1] Validar o UAT no host novo: bloco **UAT** do runbook do host novo (apontar o UAT fixo para o preview do PR) e o smoke test do [deploy-uat.md](./deploy-uat.md).
   Verificar: home `200`, `/api/mcp` sem token → `401` com `WWW-Authenticate` (`resource_metadata`), login pelo Auth0 de UAT ok.
5. [R3] Humano: aprovar o UAT e fazer o merge do PR do passo 3 na `main`.
   Verificar: `gh pr view <n> --json state` → `MERGED` e o bloco **Prod** do host novo mostra o deploy do `mergeCommit` saudável na URL do host (ainda sem o domínio).
6. [R2] Cortar Prod: apontar o domínio `<preencher: domínio de Prod>` para o host novo (registro DNS e certificado no host novo: domínio customizado do app/serviço) e somar a URL no Auth0 de Prod; depois do corte, atualizar `MCP_RESOURCE_URL`/URLs públicas se mudaram (bloco **Segredos e envs**). Baixe o TTL do DNS um dia antes.
   Verificar: `curl -sI https://<preencher: domínio de Prod>/` responde `200` com cabeçalhos do host novo (ex.: `via: 1.1 google` no Cloud Run, `via: 1.1 vegur`/`heroku-router` no Heroku, `x-vercel-id` na Vercel) e o smoke test do [deploy-prod.md](./deploy-prod.md) passa.
7. [R2] Desmontar o host antigo, depois de `<preencher: dias de observação>` dias sem incidente: bloco **Encerrar** do runbook do host antigo, um recurso por aprovação; tirar do Auth0 as URLs antigas e, no GitHub, os segredos/variáveis só do host antigo (ex.: `VERCEL_AUTOMATION_BYPASS_SECRET`, `HEROKU_API_KEY`, `AUTH0_MGMT_*`).
   Verificar: o host antigo não lista mais os recursos e o domínio de Prod segue no host novo.

## Verificação final

- `deploy.config.json` com o host novo na `main`; `Regressão (UAT)` verde no host novo; domínio de Prod servido pelo host novo; host antigo desmontado.
- O ADR do projeto registra a migração e os runbooks do host antigo ficam no catálogo (servem para voltar).

## Rollback

1. [R2] Antes do passo 7, voltar o domínio de Prod para o host antigo (DNS do passo 6 com os valores anteriores); o host antigo ainda está de pé com as envs.
   Verificar: `curl -sI https://<preencher: domínio de Prod>/` mostra os cabeçalhos do host antigo e o smoke test passa.
2. [R1] Reverter o `deploy.config.json` por PR (revert do PR do passo 3), com o merge feito pelo humano.
   Verificar: no PR de revert, o job `Deploy` roda com o host antigo e a `Regressão (UAT)` fica verde.

## Registro

Issue com label `ops` (`gh issue create --label ops --title "migração de host: <de> → <para>" --body-file <arquivo>`):
hosts, PRs (código do app e `deploy.config.json`), data do corte de DNS, aprovações R2, passos R3,
recursos desmontados, resultado final. Nunca valores de segredo.
