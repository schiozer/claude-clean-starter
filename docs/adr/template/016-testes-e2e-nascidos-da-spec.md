# 016. Testes E2E e sistêmicos nascidos da spec, regressão obrigatória no UAT e ajuda gerada

**Data**: 2026-11-11
**Status**: Aceito

## Contexto

Até aqui o template tratava E2E como **opcional** ("entra quando a UI estabiliza", no
[guia de testes](../../guides/testing-guide.md)) e não tinha Playwright. O teste de ponta a ponta
nascia depois do código, quando nascia. Faltavam também os **requisitos não funcionais**
(hardening, timeout de API e de UI, sessão, performance) e a **usabilidade** como coisas
verificadas, e não só declaradas.

O pedido do humano: escrever os testes sistêmicos e E2E **na especificação**, rodá-los com
Playwright a cada feature (com usabilidade), consolidá-los numa **suíte regressiva** que roda a
cada promoção para o UAT, e gerar da mesma jornada a **documentação interativa** (e, depois,
demos e treinamento).

Restrições:

- A QA precisa ler e ajustar os cenários **sem abrir código**.
- O repositório não tem branch protection (plano gratuito, [ADR-014](./014-release-management.md)):
  "travar o merge" é check obrigatório vermelho + alarme da `Guarda da main`
  ([ADR-005](./005-trunk-based-development.md)).
- A `main` só recebe mudança por PR (regra 0): nada pode ser escrito na `main` pelo CI depois do
  merge.
- Nenhum teste toca Prod; nenhum material gerado mostra dado real, segredo ou token.

Spec completa: `docs/superpowers/specs/2026-11-09-e2e-regressao-docs-design.md` (§§4–10).

## Decisão

1. **O cenário nasce na spec.** O `docs/superpowers/specs/_TEMPLATE.md` tem critérios `CA-n` e as
   seções "7. Requisitos não funcionais" (só os desvios do baseline, `RNF-<CAT>-NNN`) e
   "8. Cenários de teste": um bloco `### CT-<CTX>-NNN — título` por cenário, em português,
   Dado/Quando/Então, com `Tipo` (um de `@e2e`, `@sistemico`, `@rnf`, `@usabilidade`),
   `Destino` (`@regressao`, `@doc`, `@demo`, `@treinamento`), `Critério` e `Perfil`
   (`usuário final` | `time interno`). O Claudinho rascunha no brainstorming; a **QA revisa** e a
   spec só fica `Aprovada` com os cenários revisados. O ID nunca é reutilizado
   (`Aposentado: <motivo>`).
2. **`@regressao` é o padrão.** Todo cenário entra na suíte permanente; sair exige
   `Fora da regressão: <motivo>` escrito no bloco. A suíte cresce sem depender de lembrar.
3. **Cobertura mínima por feature com UI ou rota nova**: um `@e2e` do caminho feliz por `CA-n`,
   um de erro funcional ([ADR-009](./009-erros-funcional-vs-tecnico.md)), um `@sistemico` por
   rota/tool nova (incluindo 401/403 fail-closed) e os cenários de usabilidade do baseline.
   Feature só de backend dispensa `@e2e` e `@usabilidade`, com o motivo escrito na spec.
4. **Baseline de RNF e usabilidade num lugar só**: `docs/rnf.md` (do projeto, não gerenciado
   pelo template-sync) traz as tabelas de requisitos (hardening `RNF-SEG-*`, timeout `RNF-TMO-*`,
   sessão `RNF-SES-*`, performance `RNF-PRF-*`, usabilidade `USA-*`) e a lista de **telas**
   cobertas. Os testes de `tests/e2e/baseline/` leem os valores dali; nenhum número é redigitado
   no código. Página nova fora de "Telas" e de "Exclusões" falha no PR que a criou.
5. **Teste Playwright ligado pelo ID.** O título do teste começa pelo ID e as tags são o tipo +
   os destinos (`@regressao` por extenso). Os passos não são redigitados: `jornada(id, passos)`
   (`tests/e2e/support`) lê o cenário da spec e roda um `test.step` por passo, com a
   implementação cuja chave é o texto do passo. Seletores por papel e nome acessível. Projetos
   do Playwright: `setup` (login dos perfis), `sistemico` (`@sistemico`/`@rnf`, sem navegador),
   `desktop` (1280×800) e `mobile` (iPhone de referência), só Chromium. `retries: 1` no CI serve
   só para coletar trace; teste que passa na 2ª tentativa é `flaky` e **reprova** o check.
6. **Check `Cenários × testes`** (`scripts/check-cenarios.mjs`, `npm run check:cenarios`), passo
   do job `PR gate`: cenário `@regressao` sem teste, teste órfão, passos divergentes, `@doc` sem
   página de ajuda, ID repetido ou aposentado reaparecendo. Bloqueia o que é da spec do PR; dívida
   de specs antigas é aviso. Gera o **relatório de rastreabilidade** (`.e2e/rastreabilidade.md` e
   o resumo do job).
7. **Check obrigatório `Regressão (UAT)`** (`.github/workflows/e2e-regressao.yml`), em todo PR,
   com o mesmo nome no template e nos projetos, e em `requiredChecks` de
   `hooks/protect-main/config.json`. Roda `@regressao` + os cenários novos/alterados das specs do
   PR (`scripts/e2e/grep-regressao.mjs`). Alvo:
   - `E2E_TARGET=preview` (variável do repositório, projeto com UAT): espera o deploy Preview da
     Vercel do SHA do PR (`scripts/e2e/wait-preview.mjs`, ~15 min) e roda contra ele com o
     bypass da _Deployment Protection_, login real no Auth0 (`E2E_AUTH=auth0`) e os segredos do
     runbook [`e2e-uat-configurar.md`](../../runbooks/e2e-uat-configurar.md);
   - sem `E2E_TARGET` (template, ou projeto antes do bootstrap): o `webServer` do Playwright sobe
     o app local (`APP_ENV=e2e`, no template o `examples/walking-skeleton`) com o login stub.
     Vermelho trava o merge (alarme da `Guarda da main` se alguém mergear assim). O runbook
     [`deploy-uat.md`](../../runbooks/deploy-uat.md) espera o check verde antes de liberar o UAT.
8. **Documentação interativa, sempre, gerada no PR.** `npm run docs:gerar` roda os cenários `@doc`
   contra o app local e grava uma página por cenário (screenshot + legenda por passo) no diretório
   `ajuda` do `tests/e2e/cenarios.config.json`, commitada na feature branch (nunca escrita na
   `main` pelo CI). O app a serve em `/ajuda`, com guard por perfil (`time interno` exige o escopo
   `ajuda:interno`) e imagens por rota autenticada, nunca de `public/`. A captura mascara campos
   sensíveis e falha se um segredo conhecido aparecer na tela.
9. **Demos e treinamento em vídeo** são tratados no [ADR-017](./017-bunny-videos-demos-treinamento.md)
   (Bunny Stream, toggle `DEMOS_BUNNY`). As tags `@demo`/`@treinamento` já podem ser escritas na spec; o ADR-017 as consome.
10. **Toggle (ADR-006)**: regressão e documentação **sem toggle** (sempre).

## Consequências

- **Mais fácil**: a QA revisa o que vai ser testado antes do código; a regressão cresce sozinha;
  a ajuda mostra a tela que está no código do PR; RNF deixam de ser só texto.
- **Mais caro**: todo PR (inclusive de docs) roda a suíte inteira e espera o Preview. É o preço
  de uma regra sem exceção (nenhum check ausente).
- **Dados de teste no UAT**: usuários de teste dedicados (dois perfis) e quatro PATs de atores de
  teste, emitidos uma vez pelo runbook; cada execução grava dados com sufixo próprio
  (`E2E_RUN_PREFIX`) para não colidir.
- **Artefatos sensíveis**: no modo preview, traces e relatório do Playwright carregam o segredo de
  bypass da Vercel e o `x-e2e-secret`. O workflow só os publica em repositório **privado**; em
  repositório público sobe só a rastreabilidade (`.e2e/`). Retenção de 7 dias.
- **PR de fork** não recebe segredos: no modo preview o job falha com erro explícito (o PR tem de
  vir de uma branch do repositório).
- **Limitação conhecida — rate limit**: o limitador do skeleton é em memória, por instância. O
  RNF-SEG-005 no UAT pressupõe uma instância quente por preview; com várias instâncias o 429 pode
  não aparecer. Um limitador compartilhado ([ADR-010](./010-rate-limit-em-tabela-postgres.md))
  remove a limitação.
- **Risco aceito — `APP_ENV=e2e`**: `isE2eLocalEnvironment()` é `APP_ENV === 'e2e' && !VERCEL`,
  sem guarda de `NODE_ENV`. Na Vercel é inerte; num host que não seja a Vercel, `APP_ENV=e2e`
  liga o login stub e os PATs fixos. **Nunca** defina `APP_ENV=e2e` fora do runner de CI ou da
  máquina local.
- **Injeção de lentidão** (`x-e2e-delay-ms` + `x-e2e-secret`) só vale com `APP_ENV` na allowlist
  (`e2e`, `uat`, `dev`, `development`) e `E2E_FAULTS_SECRET` com ao menos 16 caracteres; em Prod é inerte,
  com teste.
- **Dívida**: tour guiado no app, regressão visual por pixel, WebKit/Firefox e teste de carga
  ficam como itens futuros da spec (§11).

## Alternativas Consideradas

- **Cucumber / playwright-bdd** (`.feature` executáveis): exigiria uma camada de step definitions
  que a QA não lê e duplicaria a spec. Ligar por ID + texto dos passos (`jornada()` +
  `check-cenarios`) dá a mesma garantia com menos peças.
- **Manter E2E opcional**: o teste continuaria nascendo depois do código (ou nunca), sem
  regressão acumulada nem RNF verificado.
- **Regressão só no merge** (ou só no deploy de Prod): o defeito seria descoberto depois de a
  mudança estar na `main`. Rodar no PR, contra o Preview do UAT, trava antes do merge.
