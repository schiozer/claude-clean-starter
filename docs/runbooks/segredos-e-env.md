# Runbook: Envs e segredos por ambiente

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

## Objetivo

Criar ou alterar variáveis de ambiente do app no host (UAT e Prod) e criar/rotacionar **segredos**
sem que o valor passe pelo agente ([ADR-013](../adr/template/013-governanca-operacional-e-runbooks.md)
§4). Dev local usa `.env.local`, editado só pelo humano e nunca commitado. Os comandos de cada host
ficam no bloco **Segredos e envs** do runbook do host do `deploy.config.json`
([host-vercel.md](./host-vercel.md), [host-heroku.md](./host-heroku.md),
[host-cloudrun.md](./host-cloudrun.md)); a classe de risco de cada passo segue a do bloco quando ela
for maior (ex.: no Heroku e no Cloud Run toda mudança de env é R2).

## Pré-condições

- Nome da env, ambiente-alvo e se é **segredo** (credencial, token, chave) ou **não-secreta** (URL pública, `APP_ENV`, flag) definidos pelo humano. Na dúvida, é segredo.
- Para rotação: a nova credencial é gerada **pelo humano** no provedor (Auth0, Neon…).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir a conta e o projeto do host: Pre-flight do runbook do host (host-<host>.md).
3. [R0] Listar as envs do ambiente (só nomes): bloco **Segredos e envs** do runbook do host, passo de listar.

## Passos

1. [R1] Env **não-secreta** no UAT: bloco **Segredos e envs** do runbook do host, passo de env não-secreta. Em Prod é **R2** (e no Heroku e no Cloud Run, R2 também no UAT).
   Verificar: a listagem de nomes do bloco lista `<NOME>` no UAT.
2. [R2] **Segredo** (criar ou rotacionar, qualquer ambiente): o agente pede ao humano que rode, **num terminal separado, fora da sessão do agente** (ou pelo dashboard do host), o passo de segredo do bloco **Segredos e envs** do runbook do host, digitando o valor no prompt (ou sem eco, com `read -s`). Nunca pelo prefixo `!` da sessão: a saída cairia no contexto do agente. O agente não vê, não ecoa e não passa o valor em argumento.
   Verificar: a listagem de nomes do bloco lista `<NOME>` no ambiente (a data de atualização ou a release/revisão mudou).
3. [R1] Fazer o valor valer no UAT. Na Vercel: passo de redeploy do bloco **Segredos e envs** do host-vercel.md e reapontar o UAT fixo ([deploy-uat.md](./deploy-uat.md)); Prod é **R2**. No Heroku: não há passo de redeploy, a mudança de env já cria a release e reinicia o app (review apps abertos só pegam a env nova com um push no PR). No Cloud Run: passo de levar a env ao preview do bloco **Segredos e envs** do host-cloudrun.md (push no PR e, para o UAT fixo, reapontar a tag `uat`). O deploy em execução segue com o valor antigo até aqui.
   Verificar: o novo deploy fica `Ready` e o smoke test do ambiente passa (`200` na home, `401` com `WWW-Authenticate` (`resource_metadata`) em `/api/mcp` sem token).
4. [R3] Humano: na rotação, revogar a credencial antiga no provedor depois que o ambiente estiver saudável com a nova.
   Verificar: smoke test do ambiente continua passando após a revogação.

Proibido (R3): baixar ou listar **valores** das envs para stdout ou para arquivo que o agente leia
(ver o bloco **Segredos e envs** de cada host), `echo`/`cat` de segredo, segredo em commit, log,
comentário de PR ou argumento de comando visível.

## Verificação final

- O nome da env existe no ambiente certo; o ambiente foi redeployado e está saudável; na rotação, a credencial antiga foi revogada.

## Rollback

1. [R2] Voltar ao valor anterior (se a credencial antiga ainda é válida): o humano repete o passo 2 com o valor anterior; depois redeploy (passo 3).
   Verificar: smoke test do ambiente passa.
2. [R1] Env não-secreta no UAT: repetir o passo 1 com o valor anterior (no Heroku e no Cloud Run, R2); redeploy (passo 3).
   Verificar: a listagem de nomes do bloco lista `<NOME>` no UAT e o comportamento voltou.

## Registro

Comentário no PR relacionado ou issue `ops`: **nome** da env, ambiente, criada/alterada/
rotacionada, aprovação R2, redeploy, resultado final. Nunca o valor.
