# Spec: Testes E2E e sistêmicos nascidos da spec — regressão no UAT, documentação, demos e treinamento

**Data**: 2026-11-09
**Status**: Rascunho
**Autor(es)**: Fabio Schiozer + Claudinho

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano e a
> implementação. Vira o **ADR-016** (testes E2E/sistêmicos e regressão) e o **ADR-017** (Bunny
> como plataforma de vídeo). Itens marcados _(decisão do Claudinho)_ não foram ditos pelo humano
> e podem ser revistos na leitura.

## 1. Contexto e Objetivo

Hoje o template trata E2E como **opcional** ("entra quando a UI estabiliza" —
`docs/guides/testing-guide.md`) e não há Playwright instalado em lugar nenhum. O teste de ponta a
ponta nasce depois do código, quando nasce.

O humano pediu (literal): "no momento da especificação funcional e técnica, devemos escrever, via
definição de arquitetura, os testes sistêmicos e E2E. Com isso, a cada funcionalidade temos que
executar esses testes com Playwright, incluindo teste de usabilidade do sistema. Além disso, os
testes devem ir consolidando como testes regressivos, que devem ser executados a cada promoção de
ambientes, ou seja, quando vamos para UAT". E depois: as definições de arquitetura incluem
**requisitos não funcionais** ("hardening de aplicação, timeout de API, de sessão, etc."), e os
testes "devem cobrir a navegação de telas ao ponto de ser possível gerar uma demo para apresentar
as features novas aos usuários e, oriundo desses testes, gerar treinamento e documentação
interativa".

**Objetivo**: inverter a ordem — **o cenário de teste nasce na spec**, escrito para a equipe de
QA ler; vira teste Playwright na implementação; entra numa **suíte regressiva** que cresce a cada
feature e roda a cada promoção para UAT, travando o merge se falhar. Da mesma jornada de teste
saem a **documentação interativa** (sempre), as **demos em vídeo** e o **treinamento** (ligáveis
por projeto, publicados no Bunny no merge).

**Para quem**:

- **QA** — lê e ajusta os cenários na spec; lê o relatório de rastreabilidade e o relatório do
  Playwright sem abrir código.
- **Usuário final e time interno** — consomem documentação, demos e treinamento na página de
  ajuda do site.
- **Claudinho / devs** — escrevem cenários na spec e os testes na implementação.

**Sucesso** =
(a) toda spec de feature tem cenários com ID, legíveis por QA, cobrindo funcional, sistêmico, RNF
e usabilidade;
(b) todo cenário `@regressao` tem um teste Playwright ligado pelo ID, e o CI acusa cenário sem
teste;
(c) todo PR roda a suíte regressiva inteira contra o preview do UAT, e o check vermelho trava o
merge;
(d) todo cenário `@doc` gera uma página de documentação interativa versionada junto com o código;
(e) com o Bunny ligado, todo merge publica as demos da versão e atualiza o treinamento;
(f) tudo isso está demonstrado no `examples/walking-skeleton` e coberto por testes do tooling.

## 2. Não-Objetivos

- **Teste de carga/estresse** (k6, Artillery). RNF de performance aqui é só orçamento simples por
  requisição/página (§5.4).
- **Rodar a suíte contra Prod.** Nem regressão nem gravação de demo tocam produção.
- **Substituir o aceite humano do UAT.** O checkbox de UAT no PR continua sendo do humano (ADR-014).
- **Regressão visual por pixel** (comparação de screenshots) — adiada (§11).
- **Narração em áudio** (TTS) nas demos e **tour guiado dentro do app** — adiados (§11).
- **Cucumber/Gherkin executável** — os cenários são texto na spec; o teste é TypeScript (§10).
- **Bloqueio técnico do merge pelo GitHub**: o repositório não tem branch protection (plano
  gratuito, ver ADR-014 §2). "Trava" significa **check obrigatório vermelho + alarme da `Guarda da
main`** se alguém mergear assim — o mesmo modelo dos demais gates.

**Anti-objetivos** (falharia mesmo "funcionando"):

- Suíte instável que o time aprende a ignorar ou a rodar de novo até passar.
- Documentação ou demo que mostra uma tela diferente da que está no ar.
- Vídeo ou screenshot com dado real de cliente, segredo ou token visível.
- Cenários escritos em linguagem de código que a QA não consegue revisar.

## 3. Visão geral

```
SPEC (brainstorming)                    QA lê e ajusta os cenários
 ├─ §RNF: baseline do projeto + desvios da feature
 └─ §Cenários: CT-<CTX>-NNN  Dado/Quando/Então  @e2e|@sistemico|@rnf|@usabilidade  @regressao @doc @demo @treinamento
        │
IMPLEMENTAÇÃO (TDD)
 ├─ tests/e2e/**/*.spec.ts   test('CT-RES-003 …', { tag }) + jornada(passos = Dado/Quando/Então)
 └─ npm run docs:gerar → docs/ajuda/<feature>/ (passo a passo + screenshots) — commitado na branch
        │
PR aberto/atualizado
 ├─ CI (existe) + Cenários × testes (novo, sempre)  rastreabilidade spec ↔ teste ↔ doc
 └─ deploy preview Vercel → Regressão (UAT) (novo, sempre, obrigatório)
        suíte @regressao inteira + cenários novos, contra a URL do preview
        relatório Playwright + rastreabilidade como artefato, link no PR
merge (squash, humano)
 ├─ Release (existe) → tag vX.Y.Z
 └─ Demos & Treinamento (novo, TOGGLE DEMOS_BUNNY)
        grava @demo/@treinamento no app do commit da tag → Bunny Stream + catálogo → página /ajuda
```

## 4. Cenários na spec

### 4.1 Formato

O `docs/superpowers/specs/_TEMPLATE.md` troca a seção "7. Testes" por duas seções:

**"7. Requisitos não funcionais"** — só o que **foge do baseline** do projeto (§5), com ID
`RNF-<CAT>-NNN`. Ex.: "RNF-TMO-010: o upload aceita até 30 s (baseline: 10 s)". Se nada foge,
escrever "Segue o baseline".

**"8. Cenários de teste"** — um bloco por cenário, em português, Dado/Quando/Então:

```markdown
### CT-RES-003 — Publicar um recurso com itens

Tipo: @e2e Destino: @regressao @doc @demo
Critério: CA-2 Perfil: usuário final

Dado que estou logado e tenho o recurso "Plano de estudos" com 2 itens
Quando abro a lista de recursos
E publico o recurso "Plano de estudos"
Então vejo o selo "Publicado" no recurso
E o recurso aparece para os outros membros do time
```

- **ID** `CT-<CTX>-NNN`: `<CTX>` é a sigla do módulo/contexto; o número é sequencial **por
  contexto no projeto**, nunca reutilizado (um cenário removido deixa o ID aposentado). O ID é a
  chave de tudo — teste, documentação, vídeo e rastreabilidade.
- **Tipo** (um): `@e2e` (pelo navegador), `@sistemico` (API REST/MCP, sem navegador), `@rnf`,
  `@usabilidade`.
- **Destino** (zero ou mais): `@regressao` (entra na suíte permanente), `@doc` (gera documentação
  interativa), `@demo` (vira vídeo da versão), `@treinamento` (vira vídeo da trilha de
  treinamento).
- **Critério**: liga o cenário a um ou mais critérios de aceitação (`CA-n`) da spec — os critérios
  ganham IDs `CA-n` no template.
- **Perfil**: quem aparece no material gerado (`usuário final` | `time interno`), usado para
  separar a documentação (§7.3).

_(decisão do Claudinho)_: `@regressao` é o **padrão** de todo cenário `@e2e`, `@sistemico`, `@rnf`
e `@usabilidade`; um cenário fora da regressão precisa de justificativa escrita no bloco
(`Fora da regressão: <motivo>`). Isso faz a suíte "ir consolidando" sem depender de lembrar.

### 4.2 Quem escreve e quando

- O Claudinho **rascunha** os cenários durante o brainstorming/spec, a partir do fluxo do usuário
  (§3 da spec), das regras de negócio e dos RNF.
- A **QA lê e ajusta** na própria spec (no PR da spec ou antes do plano). A spec só passa a
  `Status: Aprovada` com os cenários revisados.
- O plano (`writing-plans`) tem uma tarefa por cenário (ou grupo pequeno), em TDD: o teste
  Playwright do cenário é escrito antes do código da tela/rota.

### 4.3 Cobertura mínima por feature

Toda feature com UI ou rota nova tem, no mínimo: 1 cenário `@e2e` do caminho feliz por critério de
aceitação, 1 de erro funcional (regra de negócio recusada — ADR-009), 1 `@sistemico` por rota/tool
nova (incluindo 401/403 fail-closed), e passa pelos cenários de `@usabilidade` do baseline (§6).
Feature só de backend dispensa `@e2e` e `@usabilidade`, com o motivo escrito na spec.

## 5. Requisitos não funcionais (RNF)

### 5.1 Duas camadas

1. **Baseline do projeto** — RNF que valem para tudo, declarados **uma vez** com valor e ID, e
   testados **sempre** na regressão. O template traz o baseline padrão (§5.2) num arquivo do
   projeto (`docs/rnf.md`, criado na adoção, **não gerenciado** pelo template-sync — o projeto
   ajusta os valores). Os valores usados pelos testes saem desse mesmo lugar (fonte única; o
   formato exato — tabela parseada ou config tipado que gera o `.md` — fica com o builder, desde
   que a QA leia sem abrir código e não haja dois lugares para o mesmo número).
2. **Desvios da feature** — a spec declara só o que foge do baseline (§4.1), com teste próprio.

### 5.2 Baseline padrão (valores iniciais — o projeto ajusta)

| Categoria   | ID          | Requisito verificável                                                                                                                                                            |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardening   | RNF-SEG-001 | Headers em toda resposta HTML: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors`/`X-Frame-Options` |
| Hardening   | RNF-SEG-002 | Cookie de sessão `Secure`, `HttpOnly`, `SameSite=Lax` ou mais restrito                                                                                                           |
| Hardening   | RNF-SEG-003 | Toda rota `/api/*` (exceto as públicas declaradas) responde 401 sem identidade e 403 sem escopo — fail-closed                                                                    |
| Hardening   | RNF-SEG-004 | Erro técnico não vaza stack trace, SQL nem mensagem interna (corpo `{ error, code }` genérico — ADR-009)                                                                         |
| Hardening   | RNF-SEG-005 | Rate limit responde 429 ao exceder o limite do ator (ADR-010)                                                                                                                    |
| Hardening   | RNF-SEG-006 | `/api/mcp` sem token → 401 com `WWW-Authenticate` + `resource_metadata` (ADR-012)                                                                                                |
| Timeout     | RNF-TMO-001 | Rota de API não passa de **10 s**; ao estourar, devolve erro técnico tratado (não pendura)                                                                                       |
| Timeout     | RNF-TMO-002 | A UI desiste da chamada após **15 s** e mostra o estado "tente novamente" (erro técnico)                                                                                         |
| Sessão      | RNF-SES-001 | Sessão expira por inatividade em **8 h** e tem vida máxima de **7 dias** (o projeto ajusta)                                                                                      |
| Sessão      | RNF-SES-002 | Sessão expirada/inválida em rota de tela → redireciona ao login e volta à página de origem após logar                                                                            |
| Sessão      | RNF-SES-003 | Logout invalida a sessão no servidor (cookie antigo reaproveitado → 401)                                                                                                         |
| Performance | RNF-PRF-001 | Chamada de API do caminho feliz responde em **< 1 s** no UAT (orçamento por requisição, não p95 de carga)                                                                        |
| Performance | RNF-PRF-002 | LCP **< 2,5 s** nas páginas principais no perfil mobile                                                                                                                          |

### 5.3 Como cada categoria é testada _(decisão do Claudinho)_

- **Hardening**: `@sistemico` com o `request` do Playwright — lê headers, cookies, status e corpo.
- **Timeout da UI (TMO-002)**: `@e2e` que atrasa a resposta com `page.route` além do limite e
  confere a mensagem de erro técnico. Não exige mudança no servidor.
- **Timeout do servidor (TMO-001)**: duas verificações — (1) a configuração declarada da rota
  (`maxDuration`/timeout do handler) é ≤ o valor do baseline (teste de unidade/estático); (2) um
  `@sistemico` com **injeção de lentidão** só fora de Prod: um header de teste (`x-e2e-delay-ms`)
  aceito apenas com `APP_ENV != production` **e** um segredo de teste válido. Em Prod o código de
  injeção é inerte (fail-closed) e há teste afirmando isso.
- **Sessão**: não se espera 8 h. Verifica-se (1) os atributos observáveis (`Max-Age`/`exp` do
  cookie/token batem com o baseline) e (2) o comportamento com sessão **forjada como expirada**
  (cookie/token com `exp` no passado, ou removido) → redireciona e volta à origem.
- **Performance**: medida no próprio teste (`Date.now()` em volta da requisição; LCP via
  `PerformanceObserver` na página), contra o UAT; falha se passar do orçamento por margem
  configurável, para não virar fonte de instabilidade.

## 6. Usabilidade _(decisão do Claudinho — o humano pode revisar)_

Cenários `@usabilidade` do baseline, aplicados a **toda tela** listada no projeto:

1. **Acessibilidade automática**: `@axe-core/playwright` com regras WCAG 2.2 AA; zero violações
   `serious`/`critical` (as `moderate` viram aviso no relatório).
2. **Responsivo**: as jornadas `@e2e` rodam em **dois projetos** do Playwright — desktop
   (1280×800) e mobile (iPhone de referência). Sem rolagem horizontal; alvo de toque ≥ 44 px.
3. **Teclado**: o caminho feliz de cada critério é completável só com teclado (Tab/Enter/Espaço/
   Esc), com foco visível.
4. **Estados**: toda ação assíncrona mostra loading; erro **funcional** aparece com o tom de aviso
   e mensagem acionável, erro **técnico** com o tom de alerta e "tente novamente" (BEST_PRACTICES,
   ADR-009) — afirmado pelo `code`/papel do componente, não por cor.
5. **Nome acessível**: todo botão só-ícone tem `aria-label` (BEST_PRACTICES).

_(decisão do Claudinho)_: a lista de telas cobertas é **declarada** no `docs/rnf.md` (rota +
nome legível, uma linha por tela) e os cenários do baseline iteram sobre ela. O `check-cenarios`
compara com as páginas do app (`src/app/**/page.tsx`): página nova que não está na lista nem na
lista de exclusões declarada (ex.: telas de login do IdP, `/ajuda`) **falha** no PR que a criou.
Páginas antigas fora da lista geram só aviso.

## 7. Implementação dos testes (Playwright)

### 7.1 Estrutura

```
tests/e2e/
├── support/             # gerenciado pelo template: jornada(), fixtures, auth, axe, rnf, demo overlay
├── baseline/            # cenários do baseline (RNF + usabilidade) — vêm com o template, valores do docs/rnf.md
└── <contexto>/          # cenários das features: <contexto>/<feature>.spec.ts
playwright.config.ts     # projetos: sistemico, desktop, mobile; baseURL = E2E_BASE_URL ou webServer local
```

- **Ligação ao cenário**: o título do teste começa pelo ID e usa as tags nativas do Playwright —
  `test('CT-RES-003 publicar recurso com itens', { tag: ['@e2e', '@regressao', '@doc', '@demo'] }, …)`.
- **Jornada** _(decisão do Claudinho)_: os passos **não são redigitados no teste**. O helper
  `jornada(page, 'CT-RES-003', { 'abro a lista de recursos': async () => {…}, … })` lê o cenário
  da spec em tempo de execução e executa, em ordem, um `test.step` por passo, com o texto da spec,
  chamando a implementação cuja chave é aquele passo. As chaves do mapa são literais, e o
  `check-cenarios` confere **estaticamente** (sem rodar o teste) que elas são exatamente os passos
  do cenário: falta, sobra ou divergência → falha. A normalização ignora a palavra inicial
  (`Dado`/`Quando`/`Então`/`E`/`Mas`), espaços nas pontas e espaços repetidos; acentos, aspas e
  maiúsculas contam. Dados aparecem no texto como literais entre aspas ("Plano de estudos"). O
  prefixo único da execução (§7.2) é aplicado só ao dado gravado, nunca ao texto do passo. É o mesmo
  texto que vira legenda no vídeo e título do passo na documentação.
- **Seletores** por papel e nome acessível (`getByRole`, `getByLabel`) — reforça a usabilidade e
  evita teste frágil por classe CSS.
- **Sem instabilidade**: `retries: 1` no CI **só para coletar trace/vídeo**; um teste que passa na
  segunda tentativa é marcado `flaky` no relatório e **conta como falha** do check. Teste instável
  é corrigido ou sai da regressão por mudança explícita na spec (com motivo), nunca por `skip`
  silencioso.

### 7.2 Identidade e dados

- **Usuários de teste dedicados** por ambiente, um por perfil (`usuário final`, `time interno`),
  criados no Auth0 de UAT pelo runbook novo (§9.3). Credenciais em segredos do GitHub (R2).
- Login **uma vez** por execução (projeto `setup` do Playwright pelo Universal Login), estado
  salvo em `storageState` e reaproveitado.
- **Dados semeados** pelos próprios serviços: o setup usa um PAT do usuário de teste para criar o
  que os cenários precisam pela API/MCP (nunca acesso direto ao banco). O skeleton já emite PAT
  (`personalTokens.issue`). No UAT, o PAT de cada usuário de teste é emitido **uma vez pelo
  runbook** (§9.3) e guardado como segredo; ele não é criado no `setup`, o que evita depender do
  login para semear. No modo local, o `setup` emite o PAT direto pelo `composition` (como os testes
  de integração já fazem). Os usuários de teste vivem
  num tenant próprio (`e2e`), e cada execução usa um prefixo único (ex.: id da execução) para não
  colidir com execuções paralelas. Limpeza ao final, best-effort.
- **Dados de demonstração** (para `@doc`, `@demo`, `@treinamento`): nomes e conteúdos fictícios e
  apresentáveis, definidos no próprio cenário ("Plano de estudos"), nunca dados reais.
- **Sem segredo na tela**: o overlay de demo e a captura de screenshot mascaram campos marcados
  como sensíveis (`mask` do Playwright), e o check falha se um token conhecido aparecer no texto
  capturado.
- **Antes do bootstrap** (projeto sem UAT, ou o próprio template): a suíte roda no CI contra o app
  local (`webServer` com `next build && next start`) com o login stub de `APP_ENV=development`
  (já existe no skeleton).

### 7.3 Projetos do Playwright

| Projeto     | O que roda                                    | Navegador                       |
| ----------- | --------------------------------------------- | ------------------------------- |
| `setup`     | login dos usuários de teste, semente de dados | sim                             |
| `sistemico` | `@sistemico` + `@rnf` de API                  | não (`request`)                 |
| `desktop`   | `@e2e` + `@usabilidade`                       | Chromium 1280×800               |
| `mobile`    | `@e2e` + `@usabilidade`                       | Chromium, viewport/UA de iPhone |

_(decisão do Claudinho)_: só Chromium no início (o público principal é mobile web + desktop);
WebKit/Firefox ficam como item futuro.

## 8. Esteira

### 8.1 Check `Cenários × testes` (PR, sempre, sem custo)

Script novo (`scripts/check-cenarios.mjs`) que roda como **passo do job `PR gate`** _(decisão do
Claudinho: o job já lê o corpo do PR e faz checkout do head; nenhum check novo em
`requiredChecks`)_. Os testes unitários do script rodam no `Test & Lint (root)`, como os dos
demais scripts. Ele usa a linha `Spec:` que o PR gate já valida (ADR-014). Com `Spec: n/a — …`
(ci, docs, chore), só roda as checagens globais (IDs repetidos, órfãos) em modo aviso. Ele lê a
spec e todos os testes:

- todo cenário `@regressao` da spec tem teste com o mesmo ID; todo teste com ID aponta para um
  cenário existente (sem órfão);
- os passos do teste batem com o texto do cenário;
- todo cenário `@doc` tem página em `docs/ajuda/` com os mesmos passos (§9.1);
- IDs não se repetem nem reaparecem aposentados;
- gera o **relatório de rastreabilidade** (markdown: cenário → teste → doc → último status), que
  vai para o resumo do job e para a tabela "Spec × código" do PR.

Falha bloqueante para o que está na spec do PR; para specs antigas, só aviso (não quebra PRs de
outras features por dívida passada).

### 8.2 Check `Regressão (UAT)` (PR, sempre, obrigatório)

- Workflow novo `.github/workflows/e2e-regressao.yml`, **um único check com o mesmo nome** no
  template e nos projetos adotados: `Regressão (UAT)`. _(decisão do Claudinho)_: o gatilho é o
  `pull_request` (`opened`, `synchronize`, `reopened`), para que o check-run fique no SHA do head do
  PR, que é onde a `Guarda da main` procura (`/commits/<sha>/check-runs`). O job escolhe o alvo:
  - **projeto com UAT** (variável `E2E_TARGET=preview`): espera o deploy Preview da Vercel daquele
    SHA ficar `success` (polling na API de deployments do GitHub, com timeout de ~15 min) e roda
    contra a `target_url` com o header de bypass da _Deployment Protection_
    (`x-vercel-protection-bypass`, segredo). Timeout ou deploy com erro → check vermelho, com a
    mensagem dizendo isso;
  - **template ou projeto antes do bootstrap** (padrão, `E2E_TARGET=local`): `next build && next
start` no runner, com o login stub, e roda contra ele. No template, o app é o
    `examples/walking-skeleton`.
    Como a Vercel faz deploy de todo push no PR, um PR só de docs também tem preview e roda a
    regressão. É barato e mantém a regra simples: sem exceção, nada de check ausente.
- Executa `--grep @regressao` em todos os projetos (§7.3) + os cenários novos da spec do PR.
- Publica o relatório HTML do Playwright (traces, vídeos e screenshots das falhas) e o relatório de
  rastreabilidade como artefatos, e comenta o link no PR.
- Entra em `requiredChecks` de `hooks/protect-main/config.json`. Merge com ele vermelho ou ausente
  vira alarme da `Guarda da main` (ADR-005/014).
- **Runbook `deploy-uat.md`**: o passo 7 (smoke com `curl`) continua como pré-condição barata e
  ganha o passo "aguardar `Regressão (UAT)` verde"; vermelho → corrigir na branch, nunca liberar.

### 8.3 Job `Demos & Treinamento` (merge, toggle `DEMOS_BUNNY`)

- Disparado por `workflow_run` do workflow `Release` concluído com sucesso. O `release.yml` cria a
  Release com o `GITHUB_TOKEN`, e evento gerado por esse token não dispara `release: published`.
  Só roda se a variável de repositório `DEMOS_BUNNY` estiver `on` (mesmo padrão do `SPEC_GATE`).
  Desligado → o job sai verde com aviso. Também aceita `workflow_dispatch` com a tag.
- _(decisão do Claudinho, nunca Prod)_: a gravação é feita contra **o app construído no próprio
  runner a partir do commit da tag** (`next build && next start`, login stub, dados de
  demonstração semeados). Não grava contra o UAT, porque depois do merge o alias pode apontar para
  outro preview. Gravar no runner garante que o vídeo mostra exatamente o código da versão e que
  nenhum dado real aparece. A tela de login do IdP não entra nas demos: a jornada começa já logada.
- **Demos**: os cenários `@demo` da spec do PR daquela versão. Com squash, cada tag corresponde a
  um PR, e a spec sai da linha `Spec:` do corpo do PR, que o `release.mjs` já consulta. Um vídeo por
  cenário, coleção por versão (`vX.Y.Z`) no Bunny Stream.
- **Treinamento**: todos os cenários `@treinamento` do projeto, agrupados em trilhas por perfil;
  a coleção "Treinamento" é **substituída** a cada versão (o treinamento é sempre o atual; as demos
  ficam por versão).
- **Vídeo**: `video: 'on'` do Playwright no tamanho do projeto (desktop e mobile), com `slowMo`
  para ficar assistível e um **overlay de legenda** injetado na página mostrando o texto do passo
  atual e destacando o elemento clicado. O tratamento final (cortes, conversão) fica com o builder;
  o Bunny aceita o arquivo e transcodifica.
- Ao final, atualiza o **catálogo** (§9.2) e anexa à GitHub Release a lista de demos com links.
- Falha na publicação **não desfaz o merge**: o job fica vermelho, a Release recebe o aviso e o job
  pode ser rodado de novo manualmente (`workflow_dispatch` com a tag).

## 9. Documentação, demos e treinamento

### 9.1 Documentação interativa (sempre)

- Gerada **no PR**, não no merge, para não exigir escrita na `main` fora de PR (regra 0) e para a
  QA revisar junto: `npm run docs:gerar` roda os cenários `@doc` contra o app local, captura um
  screenshot por passo e escreve `docs/ajuda/<contexto>/<CT-ID>.md` (ou `.json`) + imagens. O
  Claudinho roda antes de abrir/atualizar o PR e commita na feature branch.
- Screenshots não são comparados por pixel (não são determinísticos); o check confere que a página
  existe e que os passos batem com o cenário (§8.1).
- O app serve isso numa rota de ajuda (ex.: `/ajuda`) com navegação por feature e, dentro do
  cenário, avançar/voltar passo a passo (screenshot + legenda). É "interativa" nesse sentido; o
  tour dentro da própria tela fica para depois (§11).
- **Perfil** _(decisão do Claudinho)_: o skeleton só tem escopos, não papéis. Por isso, o "time
  interno" é o escopo **`ajuda:interno`**. Páginas `usuário final` aparecem para todo usuário
  logado; páginas `time interno` exigem `requireScope(actor, 'ajuda:interno')` no service da ajuda
  (fail-closed). O login stub de dev ganha esse escopo para os testes.
- **Imagens** servidas por uma rota autenticada do app que aplica o mesmo guard, **nunca** de
  `public/`. Assim screenshot interno não fica acessível por URL aberta. Os arquivos ficam em
  `docs/ajuda/` e entram no bundle do servidor.
- Com `DEMOS_BUNNY` ligado, a página de cada feature também incorpora o vídeo da demo e links para
  o treinamento, lidos do catálogo.

### 9.2 Bunny (ADR-017)

- **Bunny Stream** é a plataforma de vídeo padrão (já usada no evolui.ai e no performaRM). Fica
  atrás de uma interface `IVideoHost` (`upload`, `ensureCollection`, `replaceCollection`,
  `embedUrl`) com implementação `BunnyStreamVideoHost` e um fake in-memory para os testes do
  tooling — mesmo padrão de isolamento do Neon/Auth0.
- **Catálogo** (versão → feature → cenário → vídeo/embed, trilhas de treinamento) mora **fora do
  git**, no **Bunny Storage** servido pela CDN, porque é escrito no merge. _(decisão do
  Claudinho)_: um arquivo **imutável por versão** (`catalogo/vX.Y.Z.json`) e um `catalogo/index.json`
  regravado por último. O job usa `concurrency` (sem cancelar), igual ao `release.yml`, para que
  duas gravações não disputem o índice. O app lê o índice com cache curto (ex.: 5 min). Sem Bunny,
  ou com a CDN fora do ar, a ajuda mostra só a documentação e um aviso discreto de "vídeos
  indisponíveis no momento"; a página nunca quebra.
- Segredos (`BUNNY_STREAM_API_KEY`, `BUNNY_LIBRARY_ID`, `BUNNY_STORAGE_*`) só no GitHub/Vercel,
  configurados por runbook (R2). O embed usa URL pública do player; se o projeto exigir vídeo
  privado, usa _token authentication_ do Bunny com URL assinada pelo servidor — o builder escolhe
  conforme o projeto, o padrão é público para `usuário final` e assinado para `time interno`.

### 9.3 Runbooks novos

- `e2e-uat-configurar.md` — criar usuários de teste no Auth0 de UAT; emitir o PAT de cada um;
  criar o segredo de bypass da Vercel e o segredo de injeção de lentidão; registrar tudo nos segredos
  do GitHub; ligar `E2E_TARGET=preview`.
- `bunny-habilitar.md` — criar library/collections/storage zone no Bunny, segredos, ligar
  `DEMOS_BUNNY`; desligar e rollback.

## 10. Decisões sobre o template e as skills

- **ADR-016** (novo, template): cenários na spec como fonte, tags, baseline de RNF, usabilidade,
  regressão obrigatória no UAT, documentação sempre, demos/treinamento por toggle. Revisa a frase
  "E2E opcional" do `testing-guide.md` e a pirâmide (E2E deixa de ser opcional para features com UI).
- **ADR-017** (novo, template): Bunny como plataforma de vídeo, atrás de `IVideoHost`.
- **Guia novo** `docs/guides/e2e-guide.md`: como escrever cenário, jornada, tags, RNF, dados, rodar
  local, ler o relatório. O `testing-guide.md` aponta para ele.
- **`_TEMPLATE.md` da spec**: IDs `CA-n` nos critérios; seções "Requisitos não funcionais" e
  "Cenários de teste" (§4.1).
- **Template de PR**: a tabela "Spec × código" ganha a coluna de cenários (`CA-n` → `CT-…` →
  teste → status) ou é preenchida a partir do relatório de rastreabilidade.
- **Skills** `mvp-development` e `ddd-service-development`: passo explícito "teste Playwright dos
  cenários da spec antes da tela/rota" e "`npm run docs:gerar` antes do PR". `CLAUDE.md` (regra 1 e
  checklist) e `SKILLS.md` refletem isso. A conferência spec × código local passa a incluir
  "todo cenário `@regressao` tem teste".
- **template-sync**: `tests/e2e/support/**`, `tests/e2e/baseline/**`, os scripts e workflows novos
  são **gerenciados**; `docs/rnf.md`, `docs/ajuda/**`, `tests/e2e/<contexto>/**` e o
  `playwright.config.ts` _(decisão do Claudinho: o projeto ajusta projetos/viewport)_ são do
  projeto. Atualizar `template-sync.manifest.json`.
- **Walking skeleton** (`examples/walking-skeleton`): implementação de referência completa — spec
  de exemplo com cenários do módulo `resources` (listar, criar, título inválido, 401 sem sessão),
  baseline rodando, `docs:gerar` produzindo `docs/ajuda`, rota `/ajuda`. No template, o check
  `Regressão (UAT)` (§8.2, alvo `local`) roda a suíte contra o skeleton. `Regressão (UAT)` entra no
  `requiredChecks` do `hooks/protect-main/config.json`, que já é gerenciado (`hooks/**`), então o
  mesmo nome chega aos projetos pelo template-sync.
- **Cucumber/playwright-bdd descartado** _(decisão do Claudinho)_: tornaria os `.feature`
  executáveis, mas exige uma camada de step definitions que a QA não lê e duplica a spec. Ligar
  por ID + texto dos passos dá a mesma garantia com menos peças.

**Feature toggle (ADR-006)**: avaliado com o humano. Regressão e documentação **sem toggle**
(sempre). Demos e treinamento atrás de `DEMOS_BUNNY` (variável de repositório, padrão `off`),
ligados pelo runbook `bunny-habilitar.md`.

## 11. Itens Futuros

- Tour guiado dentro do app a partir dos passos da jornada (ex.: driver.js com os seletores).
- Narração em áudio (TTS) das demos e treinamentos; legendas `.vtt` no Bunny.
- Regressão visual por screenshot.
- WebKit/Firefox nos projetos do Playwright.
- Smoke pós-deploy em Prod só leitura (sem dados), se o time quiser.
- Teste de carga para RNF de performance de verdade (p95 sob concorrência).

## 12. Critérios de Aceitação

- CA-1: O `_TEMPLATE.md` da spec tem `CA-n`, "Requisitos não funcionais" e "Cenários de teste" no
  formato do §4.1; o guia `e2e-guide.md` e os ADRs 016/017 existem e estão linkados.
- CA-2: `check-cenarios` acusa cenário `@regressao` sem teste, teste órfão, passos divergentes,
  `@doc` sem página e ID repetido/aposentado, com testes unitários do script.
- CA-3: A suíte do baseline (todos os RNF do §5.2 e a usabilidade do §6) roda verde no walking
  skeleton, nos projetos `sistemico`, `desktop` e `mobile`.
- CA-4: `Regressão (UAT)` roda no PR (contra o app local no template; contra o preview da Vercel no
  projeto adotado), publica relatório e está em `requiredChecks`; um teste quebrado deixa o check
  vermelho, e um teste `flaky` também.
- CA-5: `npm run docs:gerar` produz `docs/ajuda/` a partir dos cenários `@doc` do skeleton, e a rota
  `/ajuda` mostra o passo a passo navegável, separando `usuário final` e `time interno`.
- CA-6: Com `DEMOS_BUNNY=off`, o job de demos sai verde com aviso. Com `on` (testado com o fake de
  `IVideoHost`), ele grava os `@demo` da versão contra o app do commit da tag, publica na coleção
  da versão, substitui a de treinamento e grava `catalogo/vX.Y.Z.json` antes do `index.json`. Com
  o catálogo indisponível, a `/ajuda` mostra a documentação com aviso.
- CA-7: Injeção de lentidão é inerte com `APP_ENV=production`, com teste.
- CA-8: Runbooks `e2e-uat-configurar.md` e `bunny-habilitar.md` passam no `check:runbooks`;
  `deploy-uat.md` inclui aguardar `Regressão (UAT)`.
- CA-9: Skills, `CLAUDE.md`, `SKILLS.md`, template de PR e `template-sync.manifest.json` atualizados
  conforme o §10.
