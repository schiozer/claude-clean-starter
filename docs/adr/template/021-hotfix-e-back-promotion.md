# 021. Hotfix direto na `main` e back-promotion para a `develop`

**Data**: 2026-11-23
**Status**: Aceito

## Contexto

Com a esteira do [ADR-020](./020-esteira-integracao-e-promocao.md), a `develop` acumula o que está
em integração e a `main` é o espelho de Prod. Um bug de produção não pode esperar a próxima
promoção nem carregar junto o que ainda não passou no UAT; também não queremos cherry-pick
(diverge o histórico e se perde). Por outro lado, a correção precisa chegar à `develop`, senão a
próxima promoção a desfaz e a `main` deixa de ser ancestral da `develop` (o FF fica impossível).

Vale só para projetos com o bloco `esteira` ligado. Sem ele, o hotfix é um PR comum na `main`,
como hoje ([ADR-005](./005-trunk-based-development.md)).

## Decisão

1. **Duas esteiras**, escolhidas pela análise do bug:
   - **Esteira maior** (feature, ou correção **com cara de projeto**): `feature/*` (a partir da
     `develop`) → PR com base `develop` (squash) → pacote → UAT → **Promover para Prod**.
   - **Esteira menor** (hotfix): `hotfix/*` (a partir da `main`) → PR com base `main` (squash) →
     deploy de Prod direto, **sem UAT** (testado em Dev e no preview do PR) → Release → back-promotion.
   - **Critério**: correção com "cara de projeto" (muda regra de negócio, mexe em várias partes,
     precisa de migração não trivial ou de aceite do usuário) **entra pela `develop`** e passa
     pelo UAT. Hotfix é a correção pequena e urgente do que está em Prod.
2. **PR de hotfix**: head `hotfix/*`, base `main`. O `PR gate` exige, na seção `## UAT`,
   "UAT não se aplica — <motivo>", marcado **pelo humano** (o agente nunca marca, `[R3]`). Qualquer
   outra head com base `main` deixa o `PR gate` vermelho.
3. **Deploy do hotfix**: o push na `main` vindo do merge (pusher ≠ `esteira-promover[bot]`) roda
   `deployProd(sha)` — pacote novo direto em Prod (Heroku: build do tarball no `-prod`; Cloud Run:
   build e deploy no serviço de Prod; Vercel: o próprio build de Production da `main`). O
   `release.yml` cria a tag (patch, ou conforme o título).
4. **Back-promotion obrigatória**: quando a Release do push na `main` termina **com sucesso**, o
   `back-promotion.yml` abre (ou atualiza) o PR `main` → `develop` com o título
   `chore(release): back-promotion de vX.Y.Z`, com o token da App `esteira-promover` (PR aberto
   com o `GITHUB_TOKEN` não dispararia o `pr-gate` nem o `ci`). Hotfix seguido de outro com o PR
   ainda aberto: o mesmo PR é atualizado (a head é a própria `main`).
5. **Merge commit, nunca squash**, só neste PR (head `main`, base `develop`): a `main` precisa
   continuar ancestral da `develop` (I1 do ADR-020). O `PR gate` avisa; o merge é do humano (`[R3]`).
6. **Conflito**: o CI abre o PR mesmo assim; o agente resolve numa branch `backpromotion/*` com
   base `develop` (merge da `main` nela, merge commit permitido) e atualiza o PR.
7. **Promoção bloqueada** até a back-promotion ser mergeada e o novo deploy de UAT subir (o merge
   na `develop` redeploya o UAT e roda a `Regressão (UAT)`): o `promover.yml` recusa com
   "há back-promotion pendente: mergeie o PR main → develop e aguarde o novo deploy de UAT".
8. **Release falha → sem back-promotion e sem aviso**: abrir o PR `main` → `develop` à mão
   (runbook [`hotfix.md`](../../runbooks/hotfix.md)).

## Consequências

**Fica mais fácil**

- Corrigir Prod a partir do commit que está em Prod, sem levar junto o que está em integração.
- A correção volta para a `develop` sem cherry-pick e com rastreabilidade (merge commit).

**Fica mais difícil / dívidas assumidas**

- O hotfix vai para Prod **sem UAT**: depende do teste em Dev, do preview do PR e da
  `Regressão (UAT)` contra o preview.
- Entre o hotfix e o merge da back-promotion, a promoção fica parada.
- O repositório aceita merge commit; a Guarda e o `PR gate` precisam alarmar qualquer merge commit
  fora da back-promotion.
- Release falha não avisa que a back-promotion não foi aberta: é passo manual do runbook.

## Alternativas Consideradas

- **Hotfix passando por UAT** — descartada: o UAT da `develop` mistura o hotfix com o que está em
  integração, e o pacote do UAT levaria código não aprovado para Prod.
- **Cherry-pick da correção para a `develop`** — descartada: diverge o histórico, quebra a
  ancestralidade `main` ⊂ `develop` e o FF da promoção.
- **Squash na back-promotion** — descartada: o commit novo na `develop` não tem a `main` como
  ancestral, e a próxima promoção é recusada.
- **Back-promotion manual (sem CI)** — descartada: é fácil esquecer, e o esquecimento só aparece
  na próxima promoção.
