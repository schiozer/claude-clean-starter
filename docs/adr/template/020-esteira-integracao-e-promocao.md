# 020. Esteira "build once, promote": branch de integração e promoção do mesmo pacote

**Data**: 2026-11-23
**Status**: Aceito
**Substitui parcialmente**: [ADR-002](./002-estrategia-de-ambientes.md) (fluxo PR → UAT → merge → Prod),
[ADR-005](./005-trunk-based-development.md) (trunk única na `main`, "sem `develop`"),
[ADR-014](./014-release-management.md) (tag a cada merge na `main`) e
[ADR-018](./018-camada-de-deploy.md) (contrato do adaptador e Prod pelo auto-deploy da `main`) —
**só nos projetos que ligam o bloco `esteira`**.

## Contexto

Pelo [ADR-002](./002-estrategia-de-ambientes.md), pelo [ADR-005](./005-trunk-based-development.md)
e pelo [ADR-018](./018-camada-de-deploy.md), o PR vira um preview, o UAT é apontado **à mão** para
esse preview (bloco **UAT** do `host-<host>.md`) e o merge na `main` **recompila** para Prod. O que
vai para Prod não é o pacote testado em UAT: é um build novo do mesmo commit, com o env de Prod
no build.

O humano quer duas coisas que o fluxo atual não dá:

1. **Testar e promover o mesmo pacote** (slug no Heroku, imagem por digest no Cloud Run).
2. **Uma `main` que seja espelho de Prod**, para corrigir um bug de produção sem passar pela
   integração e sem cherry-pick.

Restrições: plano gratuito do GitHub com repositório privado (sem _required reviewers_ e, em
geral, sem branch protection); o agente nunca escreve em branch protegida (regra 0); os projetos
derivados (AssistBru.ai, ContasMes.ai, EvoluiAI, PerformaRM) recebem o template pelo
`/template-sync` ([ADR-015](./015-template-sync.md)) e não podem quebrar no sync. Spec:
`docs/superpowers/specs/2026-11-23-esteira-build-once-promote-design.md`.

## Decisão

1. **Opt-in por projeto.** A esteira liga com o bloco `esteira` em
   `hooks/protect-main/config.json`:
   `"esteira": { "integracao": "develop", "producao": "main", "prefixoHotfix": "hotfix/", "promotores": ["<login>"] }`.
   **Sem o bloco, tudo funciona como hoje** (trunk na `main`, ADR-002/005/014/018 inteiros). O
   template distribui a esteira mas **não a liga** no próprio `config.json` (não tem host para
   promover). Adoção: runbook [`adotar-esteira-develop.md`](../../runbooks/adotar-esteira-develop.md).
2. **Duas branches longevas, com papéis fixos.**
   - **`develop` — integração** (a trunk da integração contínua). Recebe as feature branches por
     PR (squash). Cada merge gera **um pacote** que vai **automaticamente** para o UAT fixo
     (`deploy.yml` → `deployUat`), seguido da `Regressão (UAT)` contra o UAT fixo, publicada no SHA
     como check `Regressão (UAT)` com `external_id` `esteira-uat`.
   - **`main` — espelho de Prod**. Contém exatamente o commit que está em Prod.
3. **Invariantes do git.**
   - I1. A `main` é ancestral da `develop` depois de toda back-promotion mergeada
     ([ADR-021](./021-hotfix-e-back-promotion.md)).
   - I2. A `main` só muda por (a) **fast-forward** do `promover.yml` para um SHA da `develop` que
     passou no UAT, ou (b) merge (squash) de PR com head `hotfix/*`.
   - I3. A `develop` só muda por merge de PR: features com squash; back-promotion (head `main`)
     com merge commit.
   - I4. Nada reescreve o histórico de `main` ou `develop` (sem `--force`; tags sobrevivem).
   - O agente nunca escreve em nenhuma das duas: a regra 0 do `CLAUDE.md` passa a valer para
     ambas. A branch de integração entra nas três camadas automaticamente (sem editar
     `protectedBranches`).
4. **Promoção = workflow `Promover para Prod`** (`promover.yml`, `workflow_dispatch`), disparado
   **só pelo humano** (`[R3]` para o agente; o hook `protect-main` barra `gh workflow run` e
   `gh api …/dispatches` dele). Roda só a partir de `main`, com `concurrency: promover` sem
   cancelar, e recusa ator fora de `esteira.promotores`. Passos: ler o SHA do último Deployment
   `uat` bem-sucedido; exigir o check `Regressão (UAT)` marcado `esteira-uat` verde nesse SHA;
   exigir a `main` ancestral do SHA (senão: back-promotion pendente); `promoverProd`; smoke test em
   Prod; se falhar, `rollbackProd` e **sem FF**; **fast-forward** da `main` com o token da GitHub
   App `esteira-promover` (`git push origin <sha>:refs/heads/main`, nunca `--force`); tag e
   Release. Runbook: [`promover-prod.md`](../../runbooks/promover-prod.md).
5. **GitHub App `esteira-promover`** como credencial do FF: o push dela passa pelo bypass da
   branch protection (quando houver) e **dispara** a Guarda, o `deploy.yml` e o `release.yml`, que
   reconhecem o pusher `esteira-promover[bot]` e não refazem deploy nem tag. A Guarda só aceita o
   caminho I2(a) com pusher = App **e** Deployment `production` bem-sucedido do `after` com
   `payload.sha` igual. Segredos `ESTEIRA_APP_ID`/`ESTEIRA_APP_PRIVATE_KEY` só no Environment
   `production`. Runbook: [`esteira-github-app.md`](../../runbooks/esteira-github-app.md).
6. **Contrato do adaptador estendido** ([ADR-018](./018-camada-de-deploy.md)): `deployUat(ctx)`,
   `urlUat(ctx)`, `promoverProd(ctx)` e `rollbackProd(ctx)`; `deployProd(ctx)` passa a ser só da
   esteira de hotfix. Estado em GitHub Deployments `uat`/`production` com `payload.sha` e o
   `payload` do host (`slug` | `digest` | `deploymentId`).
   - **Heroku**: UAT fixo (`heroku.uatApp`) recebe o build do tarball do SHA; Prod
     (`heroku.prodApp`) recebe **o mesmo slug** por pipeline promotion, só se o slug do UAT for do
     SHA pedido. O `-prod` **perde o auto-deploy da `main`**. Escrita com o segredo novo
     `HEROKU_DEPLOY_API_KEY` (só em push e no `promover.yml`, nunca em `pull_request`);
     `HEROKU_API_KEY` continua só leitura.
   - **Cloud Run**: o serviço de UAT recebe a imagem do SHA (100% do tráfego); Prod recebe **a
     mesma imagem pelo digest**. A SA de Prod precisa de `roles/artifactregistry.reader` no
     repositório do UAT.
   - **Vercel (V1)**: a `develop` é o UAT (Preview restrito à `develop` ou Custom Environment
     `uat`; alias estável em `vercel.uatAlias`). O FF da `main` dispara o build de Production da
     própria Vercel **do mesmo SHA** (`promoveAposFF: true`): garantia de **mesmo commit, não de
     mesmo pacote**. O Deployment `production` é registrado **antes** do FF (senão a Guarda
     alarma); smoke falho → `vercel rollback`, Deployment `failure` e issue `esteira` ("main à
     frente de Prod"); a correção segue pela esteira de hotfix.
7. **Configuração fora do pacote.** Neon, Auth0, flags e segredos vêm do env de cada ambiente;
   migrations rodam no release de cada um. **Proibido** usar no build valor que muda entre UAT e
   Prod (ex.: `NEXT_PUBLIC_*` com o domínio do Auth0 ou a URL da API): o cliente lê em runtime.
   O runbook de adoção exige o inventário e a migração das `NEXT_PUBLIC_*` antes de ligar a
   esteira (Heroku/Cloud Run).
8. **Versão** ([ADR-014](./014-release-management.md)): merge na `develop` não gera tag. A
   promoção gera **uma** tag com o maior bump entre os títulos dos PRs desde a última tag
   alcançável até o SHA promovido; a Release lista os PRs. Hotfix: tag no merge, como hoje.
   Back-promotion: sem tag.
9. **Guarda e PR gate por branch.** `PR gate`: base `develop` recusa head `hotfix/*` e não exige
   `## UAT` (o UAT é depois do merge); base `main` exige head `hotfix/*` com
   "UAT não se aplica — <motivo>" (marcado pelo humano); head `main` → base `develop` é a
   back-promotion. `Guarda da main`: na `develop`, todo commit precisa de PR com base `develop` e
   merge commit só do PR de back-promotion; na `main`, I2(a) ou I2(b); `forced` sempre alarma.
10. **Classes de risco** ([ADR-013](./013-governanca-operacional-e-runbooks.md)): disparar o
    `promover.yml` e mergear PR em `develop` ou `main` (inclusive back-promotion) → **R3**;
    `deployUat` automático → R1 (CI); rollback manual de Prod → R2.

## Consequências

**Fica mais fácil**

- Prod recebe o pacote que passou no UAT (Heroku/Cloud Run): sem "funcionou no UAT, quebrou no
  build de Prod". Promoção sem rebuild termina em < 5 min fora do smoke test.
- A `main` responde "o que está em Prod?" e é a base do hotfix, sem cherry-pick.
- O UAT anda sozinho a cada merge na `develop`; some o passo manual "apontar o UAT fixo".
- Rollback automático quando o smoke de Prod falha, sem a `main` avançar (Heroku/Cloud Run).

**Fica mais difícil / dívidas assumidas**

- Duas branches longevas: o hotfix exige back-promotion e, até ela ser mergeada e o UAT
  redeployado, **a promoção fica bloqueada** ([ADR-021](./021-hotfix-e-back-promotion.md)).
- Repositório passa a aceitar merge commit (`allow_merge_commit=true`), usado só na
  back-promotion; a Guarda e o `PR gate` alarmam no resto.
- Uma GitHub App a criar, instalar, guardar e rotacionar por repositório.
- **Vercel** só garante mesmo commit; se o smoke de Prod falhar, a `main` já avançou e fica à
  frente de Prod até o hotfix.
- Os gatilhos `develop` nos workflows são **fixos** (workflow não lê config): integração com
  outro nome exige editar `main-guard.yml`, `deploy.yml`, `ci.yml`, `pr-gate.yml` e
  `e2e-regressao.yml`.
- O Environment `production` não pode ter _required reviewers_: bloqueariam toda back-promotion
  e toda promoção. A proteção do `promover.yml` (`workflow_dispatch` + hook do agente +
  `esteira.promotores`) é verificação, não barreira — risco aceito.
- Projeto sem E2E configurado: a `Regressão (UAT)` sai verde com aviso
  ([ADR-016](./016-testes-e2e-nascidos-da-spec.md)) e a promoção não tem regressão real.
- `NEXT_PUBLIC_*` que difere entre ambientes precisa migrar para runtime antes da adoção.

## Alternativas Consideradas

- **Trunk na `main`, merge → UAT, "promover" → mesmo pacote em Prod** (uma branch só) —
  descartada pelo humano: ele quer a `main` como espelho de Prod para hotfix sem cherry-pick.
- **`develop` → `main` por PR** — descartada: a `main` deve ser idêntica à `develop` promovida; o
  FF pelo workflow faz isso sem PR e sem divergência.
- **`develop` → `main` por force push** — descartada a favor do fast-forward, que dá o mesmo
  resultado sem apagar tags nem commits de hotfix.
- **Hotfix passando por UAT** — descartada: o UAT não mistura hotfix com o que está em
  integração ([ADR-021](./021-hotfix-e-back-promotion.md)).
- **Promoção só no Heroku** — descartada: o Cloud Run consegue a mesma garantia pelo digest.
- **Vercel V2 (deploy de Prod em espera)** — descartada: o UAT rodaria com a configuração de Prod.
- **Só `GITHUB_TOKEN` no FF** — descartada: não passa pela branch protection e o push não
  dispara a Guarda, que perderia a promoção de vista.
- **Guardar o pacote fora do host** (GHCR, tarball no GitHub) — descartada: o Heroku recompilaria
  e o Cloud Run não puxa do GHCR.
- **Ligar a esteira para todos** (sem opt-in) — descartada: o `/template-sync` quebraria todo
  projeto que ainda não criou a `develop`.
- **Escolhida**: `develop` + FF pela GitHub App, promoção no contrato do adaptador, Vercel V1,
  opt-in pelo bloco `esteira`.
