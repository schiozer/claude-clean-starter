# Runbook: Configurar a Regressão (UAT) contra o Preview da Vercel

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT

## Objetivo

Fazer o check obrigatório `Regressão (UAT)` (`.github/workflows/e2e-regressao.yml`,
[ADR-016](../adr/template/016-testes-e2e-nascidos-da-spec.md)) rodar contra o **Preview da Vercel**
de cada PR, e não mais contra o app local do runner: usuários de teste no Auth0 de UAT, PATs dos
atores de teste, segredos do GitHub e da Vercel e a variável `E2E_TARGET=preview`. Use uma vez por
projeto, depois do `bootstrap-ambientes.md`, e de novo ao rotacionar qualquer credencial de teste.

> **Segredos (ADR-013 §4)**: senhas, PATs e segredos de bypass/falhas são digitados **pelo humano,
> num terminal separado, fora da sessão do agente** (ou no dashboard). O agente nunca vê, ecoa ou
> passa valor em argumento; só confere **nomes**.

## Pré-condições

- `bootstrap-ambientes.md` executado: UAT = ambiente Preview da Vercel, com `APP_ENV=uat` (a injeção de lentidão só vale com `APP_ENV` declarado e diferente de `production`).
- O app de login web do Auth0 de UAT aceita as URLs de Preview (callback e logout), para o Universal Login funcionar na URL de cada PR.
- O app do projeto emite PAT com escopos no UAT (`<preencher: tela/rota que emite PAT no UAT>`) e tem os escopos usados pelos testes: `resources:read`, `resources:write`, `ajuda:read`, `ajuda:interno` (ou os equivalentes do projeto).
- PRs abertos a partir de branches do próprio repositório: PR de fork não recebe segredos e, no modo preview, o job falha com erro explícito.
- Humano com admin no repositório, no projeto Vercel e no tenant Auth0 de UAT.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Conferir o scope Vercel: `vercel project ls --scope <preencher: team Vercel>` lista `<preencher: projeto Vercel>`.
3. [R0] Conferir o tenant Auth0 de UAT: o humano confirma que o dashboard aberto é `<preencher: domínio do tenant Auth0 de UAT>` (nunca o de Prod).
4. [R0] Ver o estado atual: `gh variable list --repo <preencher: owner/repo>` e `gh secret list --repo <preencher: owner/repo>` (só nomes).
5. [R0] Ver a visibilidade do repositório: `gh repo view <preencher: owner/repo> --json visibility`. Em repositório **público**, no modo preview, o workflow publica só a rastreabilidade (`.e2e/`): traces e relatório do Playwright guardam o segredo de bypass e o `x-e2e-secret`. Em repositório privado sobe tudo, com retenção de 7 dias.

## Passos

1. [R2] Criar no Auth0 de UAT os **dois usuários de teste** (perfis `usuário final` e `time interno`), dedicados, num tenant/organização de teste (`e2e`), com e-mails de teste e senhas fortes digitadas pelo humano no dashboard. Papel do usuário final: `resources:read`, `resources:write`, `ajuda:read`; do time interno: os mesmos + `ajuda:interno`.
   Verificar: o humano confirma os dois e-mails (nunca a senha) e o login de cada um no Universal Login do UAT.
2. [R2] Emitir os **quatro PATs** dos atores de teste, um ator distinto por PAT, pelo `<preencher: tela/rota que emite PAT no UAT>`, com expiração definida: `E2E_PAT_USUARIO` (o usuário final do passo 1: `resources:read`, `resources:write`, `ajuda:read`), `E2E_PAT_SEM_ESCOPO` (ator sem escopos: prova o 403), `E2E_PAT_RATE_LIMIT` (ator dedicado ao teste de rate limit: `resources:read`) e `E2E_PAT_OUTRO_ATOR` (outro ator: `resources:read`, `resources:write`; prova o isolamento do CT-RES-004). O humano guarda cada valor só até o passo 5.
   Verificar: o humano confirma os quatro PATs emitidos, com os escopos e a expiração acima (anotar a data de expiração no registro).
3. [R3] Humano: na Vercel, em Project Settings → Deployment Protection, criar o _Protection Bypass for Automation_ (gera o `VERCEL_AUTOMATION_BYPASS_SECRET`; mexer na Deployment Protection é do humano — ADR-013). Guardar o valor só até o passo 5.
   Verificar: o humano confirma que o bypass existe; a Deployment Protection continua ativa para o resto do Preview.
4. [R2] Criar o segredo de injeção de lentidão no Preview: o humano gera um valor aleatório com **ao menos 16 caracteres** (ex.: `openssl rand -hex 32`, fora da sessão) e roda `vercel env add E2E_FAULTS_SECRET preview --scope <preencher: team Vercel>`, digitando-o no prompt ([segredos-e-env.md](./segredos-e-env.md), passo 2). Nunca em `production`. Depois, redeploy do Preview (passo 3 do `segredos-e-env.md`).
   Verificar: `vercel env ls preview --scope <preencher: team Vercel>` lista o **nome** `E2E_FAULTS_SECRET` e `vercel env ls production --scope <preencher: team Vercel>` **não** o lista.
5. [R2] Criar os segredos do GitHub Actions: para cada nome, o humano roda `gh secret set <NOME> --repo <preencher: owner/repo>` num terminal separado e digita o valor no prompt — `VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_FAULTS_SECRET` (o mesmo valor do passo 4), `E2E_PAT_USUARIO`, `E2E_PAT_SEM_ESCOPO`, `E2E_PAT_RATE_LIMIT`, `E2E_PAT_OUTRO_ATOR`, `E2E_USUARIO_EMAIL`, `E2E_USUARIO_SENHA`, `E2E_INTERNO_EMAIL`, `E2E_INTERNO_SENHA`.
   Verificar: `gh secret list --repo <preencher: owner/repo>` lista os dez **nomes** (o valor nunca aparece).
6. [R1] Ligar o alvo preview: `gh variable set E2E_TARGET --body preview --repo <preencher: owner/repo>` (com ela, o workflow espera o Preview do SHA, define `E2E_AUTH=auth0` e passa os segredos do passo 5).
   Verificar: `gh variable list --repo <preencher: owner/repo>` mostra `E2E_TARGET` = `preview`.
7. [R1] Rodar a regressão num PR de teste (aberto a partir de uma branch do repositório): push na branch ou `gh run rerun <run-id>` (o `<run-id>` sai de `gh run list --workflow e2e-regressao.yml --branch <branch>`).
   Verificar: `gh pr checks <n>` mostra `Regressão (UAT)` `pass` e o comentário do `github-actions[bot]` diz `alvo: https://…` (a URL do Preview, não `app local (webServer)`).

## Verificação final

- `E2E_TARGET=preview`; os dez segredos existem no GitHub; `E2E_FAULTS_SECRET` existe só no Preview da Vercel.
- O PR de teste tem `Regressão (UAT)` verde contra o Preview, com os artefatos `regressao-uat-<run>` conforme a visibilidade do repositório.
- **Limitação conhecida — rate limit**: o limitador do skeleton é em memória, por instância. O RNF-SEG-005 pressupõe uma instância quente por Preview; se o 429 não aparecer de forma intermitente, confira se o Preview escalou para várias instâncias (a solução é um limitador compartilhado, ADR-010).
- **Nunca** defina `APP_ENV=e2e` fora do runner de CI ou da máquina local: `isE2eLocalEnvironment()` (`APP_ENV === 'e2e' && !VERCEL`) não olha `NODE_ENV`; num host que não seja a Vercel ele liga o login stub e os PATs fixos.

## Rollback

1. [R3] Humano: voltar a regressão ao alvo local (mudar o alvo de um check obrigatório é decisão do humano): `gh variable delete E2E_TARGET --repo <preencher: owner/repo>`.
   Verificar: `gh variable list --repo <preencher: owner/repo>` não lista `E2E_TARGET` e o próximo comentário do bot diz `alvo: app local (webServer)`.
2. [R2] Se as credenciais não forem mais usadas: o humano revoga os quatro PATs no app, remove os usuários de teste do Auth0 de UAT e apaga o bypass da Vercel; o agente pede a remoção dos segredos (`gh secret delete <NOME> --repo <preencher: owner/repo>`, um por aprovação) e do `E2E_FAULTS_SECRET` do Preview (`vercel env rm E2E_FAULTS_SECRET preview --yes --scope <preencher: team Vercel>`).
   Verificar: `gh secret list --repo <preencher: owner/repo>` e `vercel env ls preview --scope <preencher: team Vercel>` não listam mais os nomes removidos.

## Registro

Comentário no PR de teste (`gh pr comment <n> --body-file <arquivo>`) ou issue `ops`: runbook +
`Última verificação`, **nomes** dos segredos criados, e-mails dos usuários de teste, expiração dos
PATs, aprovações R2, resultado do PR de teste. Nunca valores.
