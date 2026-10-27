# Runbook: Envs e segredos por ambiente

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

## Objetivo

Criar ou alterar variáveis de ambiente na Vercel (Preview = UAT, Production = Prod) e
criar/rotacionar **segredos** sem que o valor passe pelo agente
([ADR-013](../adr/template/013-governanca-operacional-e-runbooks.md) §4). Dev local usa `.env.local`,
editado só pelo humano e nunca commitado.

## Pré-condições

- Nome da env, ambiente-alvo e se é **segredo** (credencial, token, chave) ou **não-secreta** (URL pública, `APP_ENV`, flag) definidos pelo humano. Na dúvida, é segredo.
- Para rotação: a nova credencial é gerada **pelo humano** no provedor (Auth0, Neon…).

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir o scope Vercel: `vercel project ls --scope <preencher: team Vercel>` lista `<preencher: projeto Vercel>`.
3. [R0] Listar as envs do ambiente (só nomes): `vercel env ls <preview|production> --scope <preencher: team Vercel>`.

## Passos

1. [R1] Env **não-secreta** no UAT: `printf '<valor>' | vercel env add <NOME> preview --scope <preencher: team Vercel>` (alterar = `vercel env rm <NOME> preview --yes` antes). Em `production` é **R2**.
   Verificar: `vercel env ls preview --scope <preencher: team Vercel>` lista `<NOME>`.
2. [R2] **Segredo** (criar ou rotacionar, qualquer ambiente): o agente pede ao humano que rode, **num terminal separado, fora da sessão do agente** (ou pelo dashboard da Vercel), `vercel env rm <NOME> <ambiente> --yes` (se já existir) e `vercel env add <NOME> <ambiente>`, digitando o valor no prompt. Nunca pelo prefixo `!` da sessão: a saída cairia no contexto do agente. O agente não vê, não ecoa e não passa o valor em argumento.
   Verificar: `vercel env ls <ambiente> --scope <preencher: team Vercel>` lista `<NOME>` (a data de atualização mudou).
3. [R1] Redeploy para o valor valer: UAT `vercel redeploy <preview-url> --scope <preencher: team Vercel>` e reapontar o alias ([deploy-uat.md](./deploy-uat.md)); Prod é **R2**. O deploy em execução segue com o valor antigo até aqui.
   Verificar: o novo deploy fica `Ready` e o smoke test do ambiente passa (`200` na home, `401` com `WWW-Authenticate` (`resource_metadata`) em `/api/mcp` sem token).
4. [R3] Humano: na rotação, revogar a credencial antiga no provedor depois que o ambiente estiver saudável com a nova.
   Verificar: smoke test do ambiente continua passando após a revogação.

Proibido (R3): `vercel env pull` para stdout ou para arquivo que o agente leia, `echo`/`cat`
de segredo, segredo em commit, log, comentário de PR ou argumento de comando visível.

## Verificação final

- O nome da env existe no ambiente certo; o ambiente foi redeployado e está saudável; na rotação, a credencial antiga foi revogada.

## Rollback

1. [R2] Voltar ao valor anterior (se a credencial antiga ainda é válida): o humano repete o passo 2 com o valor anterior; depois redeploy (passo 3).
   Verificar: smoke test do ambiente passa.
2. [R1] Env não-secreta no UAT: `vercel env rm <NOME> preview --yes` e recriar com o valor anterior; redeploy.
   Verificar: `vercel env ls preview` lista `<NOME>` e o comportamento voltou.

## Registro

Comentário no PR relacionado ou issue `ops`: **nome** da env, ambiente, criada/alterada/
rotacionada, aprovação R2, redeploy, resultado final. Nunca o valor.
