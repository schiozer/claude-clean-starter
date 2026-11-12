# Guia de E2E: cenários da spec, Playwright, regressão e ajuda

**Última Atualização**: 2026-11-11
**Versão**: 1.0.0

Como escrever um cenário de teste na spec, ligá-lo a um teste Playwright, rodar a suíte local,
ler o relatório e a rastreabilidade, e gerar a página de ajuda. A decisão está no
[ADR-016](../adr/template/016-testes-e2e-nascidos-da-spec.md); testes unitários e de integração
seguem o [guia de testes](./testing-guide.md).

> A implementação de referência é o `examples/walking-skeleton`: a spec
> `examples/walking-skeleton/docs/specs/resources.md` (cenários `CT-RES-*`), os testes em
> `examples/walking-skeleton/tests/e2e/` e as páginas geradas em
> `examples/walking-skeleton/docs/ajuda/`.

---

## 1. Onde fica cada coisa

| Caminho                          | O que é                                                                        | De quem  |
| -------------------------------- | ------------------------------------------------------------------------------ | -------- |
| `docs/superpowers/specs/*.md`    | Specs com a seção "8. Cenários de teste" (e "7. Requisitos não funcionais")    | projeto  |
| `docs/rnf.md`                    | Baseline de RNF e usabilidade, parâmetros dos testes, telas e exclusões        | projeto  |
| `tests/e2e/support/`             | Helpers: `jornada`, `dado`, `rnf`, `checarA11y`, login dos perfis, `e2eEnv`    | template |
| `tests/e2e/baseline/`            | Testes do baseline (RNF + usabilidade), com valores lidos do `docs/rnf.md`     | template |
| `tests/e2e/<contexto>/`          | Testes das features (`<contexto>/<feature>.spec.ts`)                           | projeto  |
| `tests/e2e/auth.setup.ts`        | Projeto `setup`: login de cada perfil e `storageState`                         | projeto  |
| `tests/e2e/cenarios.config.json` | Globs de specs, testes e páginas; diretório da ajuda; caminho do `docs/rnf.md` | projeto  |
| `playwright.config.ts`           | Projetos `setup`, `sistemico`, `desktop`, `mobile`; alvo local ou remoto       | projeto  |
| `scripts/check-cenarios.mjs`     | Check `Cenários × testes` e relatório de rastreabilidade                       | template |
| `scripts/e2e/`                   | Parsers de cenários/RNF/testes, filtro da regressão, espera do Preview         | template |

"De quem" segue o `template-sync.manifest.json`: o que é do template chega pelo sync; o que é do
projeto o sync nunca toca.

---

## 2. Escrever o cenário na spec

O formato completo está na seção "8. Cenários de teste" do
[`_TEMPLATE.md`](../superpowers/specs/_TEMPLATE.md). Em resumo:

```markdown
### CT-RES-001 — Criar um recurso e vê-lo na lista

Tipo: @e2e Destino: @doc @demo
Critério: CA-1 Perfil: usuário final

Dado que estou logado como usuário final
Quando abro a lista de recursos
E preencho o título "Plano de estudos"
E clico em "Criar"
Então vejo o recurso "Plano de estudos" na lista
E o campo "Título" fica vazio
```

- **ID** `CT-<CTX>-NNN`, nunca reutilizado. Cenário removido fica com `Aposentado: <motivo>`.
- **Tipo** (um): `@e2e` (navegador), `@sistemico` (REST/MCP sem navegador), `@rnf`,
  `@usabilidade`.
- **Destino** (zero ou mais): `@regressao`, `@doc`, `@demo`, `@treinamento`. `@regressao` é
  **implícito**; para tirar um cenário da regressão escreva `Fora da regressão: <motivo>`.
  `@demo` e `@treinamento` podem ser escritos, mas ainda não geram vídeo (Plano 2, ADR-017
  futuro).
- **Critério** liga a um ou mais `CA-n`; **Perfil** é `usuário final` ou `time interno` (separa
  a ajuda).
- **Passos** começam por `Dado`, `Quando`, `Então`, `E` ou `Mas`. Dados de exemplo são fictícios e
  vão entre aspas. Acentos, aspas e maiúsculas contam; a palavra inicial e os espaços repetidos
  não.

O Claudinho rascunha os cenários no brainstorming; a **QA revisa na spec** antes de ela ficar
`Aprovada`. Cobertura mínima por feature com UI ou rota nova: um `@e2e` feliz por `CA-n`, um de
erro funcional, um `@sistemico` por rota/tool nova (com 401/403) e o baseline de usabilidade.

### Requisitos não funcionais

O `docs/rnf.md` declara o **baseline** uma vez: tabela "Requisitos" (`RNF-SEG-*`, `RNF-TMO-*`,
`RNF-SES-*`, `RNF-PRF-*`, `USA-*`), "Parâmetros dos testes", "Telas" e "Exclusões". Os testes de
`tests/e2e/baseline/` leem os valores dali (`rnf(id)`, `rnfMs(id)`, `parametro(chave)`,
`telas()`). A spec só declara o que **foge** do baseline (seção 7, `RNF-<CAT>-NNN`), com um teste
de mesmo ID. Página nova do app precisa entrar em "Telas" ou "Exclusões", senão o
`check:cenarios` falha no PR que a criou.

---

## 3. Escrever o teste: `jornada()` e `dado()`

O título começa pelo ID; as tags são o tipo mais os destinos, com `@regressao` por extenso. Os
passos **não são redigitados**: `jornada(id, passos, { page })` lê o cenário da spec e roda um
`test.step` por passo, chamando a função cuja chave é o texto do passo (sem a palavra inicial).

```typescript
import { expect, test } from '@playwright/test'
import { dado, jornada } from '../support' // ajuste o caminho relativo até tests/e2e/support

test(
  'CT-RES-001 criar um recurso e vê-lo na lista',
  { tag: ['@e2e', '@regressao', '@doc', '@demo'] },
  async ({ page }) => {
    const titulo = dado('Plano de estudos')
    const campo = page.getByLabel('Título')
    await jornada(
      'CT-RES-001',
      {
        'que estou logado como usuário final': () => page.goto('/'),
        'abro a lista de recursos': () => abrirRecursos(page), // helper do próprio teste
        'preencho o título "Plano de estudos"': () => campo.fill(titulo),
        'clico em "Criar"': () => page.getByRole('button', { name: 'Criar' }).click(),
        'vejo o recurso "Plano de estudos" na lista': () =>
          expect(page.getByRole('listitem').filter({ hasText: titulo })).toHaveCount(1),
        'o campo "Título" fica vazio': () => expect(campo).toHaveValue(''),
      },
      { page }
    )
  }
)
```

- **Chave divergente da spec** (falta, sobra ou texto diferente) falha no `jornada()` em tempo de
  execução **e** no `check:cenarios`, estaticamente, sem rodar o teste.
- **`dado(texto)`** acrescenta o sufixo da execução (`E2E_RUN_PREFIX`) só ao dado gravado, nunca
  ao texto do passo. Execuções paralelas no mesmo UAT não colidem.
- **Seletores** por papel e nome acessível (`getByRole`, `getByLabel`), nunca por classe CSS.
- **Perfis**: `desktop` e `mobile` usam a sessão do usuário final (`perfis.usuario`); para o time
  interno, `test.use({ storageState: perfis.interno })`. Testes `@sistemico` usam o `request` do
  Playwright e os PATs de `e2eEnv().pat` (`usuario`, `semEscopo`, `rateLimit`, `outroAtor`).
- **Usabilidade**: `checarA11y(page)` roda o axe com `AXE_TAGS` (WCAG 2.2 AA).
- **Instabilidade não se tolera**: no CI, `retries: 1` só coleta trace; um teste que passa na
  segunda tentativa é `flaky` e reprova o check (`failOnFlakyTests`). Corrija o teste ou tire o
  cenário da regressão na spec, com motivo. Nunca `test.skip` silencioso.

---

## 4. Rodar local

```bash
npm run test:e2e                       # suíte inteira (sobe o app local pelo webServer)
npm run test:e2e -- --grep @regressao  # só a regressão
npm run test:e2e -- --grep CT-RES-001  # um cenário
npm run test:e2e -- --project=desktop  # um projeto (setup roda antes, por dependência)
npm run test:e2e -- --ui               # modo interativo do Playwright
npm run check:cenarios                 # rastreabilidade spec ↔ teste ↔ ajuda (checagens globais)
npm run check:cenarios -- --spec examples/walking-skeleton/docs/specs/resources.md
```

Na primeira vez, `npx playwright install chromium`. Sem `E2E_BASE_URL`, o `playwright.config.ts`
sobe o app com `APP_ENV=e2e` (no template, o `examples/walking-skeleton`) e usa as constantes
`LOCAL_SOMENTE_TESTE`: segredos de mentira, versionados, que só valem no app efêmero local. Fora do
CI o servidor já de pé é reaproveitado.

### Modo `e2e` local × modo preview

|                    | Local (padrão; template e projeto antes do bootstrap) | Preview (`E2E_TARGET=preview`, projeto com UAT)             |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| Alvo               | app subido pelo `webServer` (`APP_ENV=e2e`)           | Preview da Vercel do SHA do PR (`E2E_BASE_URL`)             |
| Login (`setup`)    | stub `/dev-login?perfil=…` (`E2E_AUTH` vazio)         | Universal Login do Auth0 (`E2E_AUTH=auth0`)                 |
| PATs e segredos    | `LOCAL_SOMENTE_TESTE` do `playwright.config.ts`       | segredos do GitHub (runbook `e2e-uat-configurar.md`)        |
| Proteção da Vercel | —                                                     | header `x-vercel-protection-bypass` com o segredo de bypass |

> **Nunca** defina `APP_ENV=e2e` num servidor que não seja o runner de CI ou a sua máquina:
> fora da Vercel ele liga o login stub e os PATs fixos (ver consequências do ADR-016).

---

## 5. Ler o relatório e a rastreabilidade

- **Check `Cenários × testes`** (passo do job `PR gate`): o resumo do job traz a tabela de
  rastreabilidade (cenário → teste → ajuda → status), também gravada em
  `.e2e/rastreabilidade.md`. Erro bloqueia o que é da spec do PR; dívida de specs antigas aparece
  como aviso. Cole a tabela na seção "Cenários × testes" do PR.
- **Check `Regressão (UAT)`** (`.github/workflows/e2e-regressao.yml`): roda `@regressao` + os
  cenários novos/alterados das specs do PR. O bot comenta no PR o resultado, o alvo e o link do
  run. Artefatos `regressao-uat-<run>` (7 dias):
  - modo local, ou repositório **privado**: relatório HTML do Playwright (`playwright-report/`,
    com traces, vídeos e screenshots das falhas), `test-results/` e `.e2e/`;
  - modo preview em repositório **público**: só `.e2e/` (rastreabilidade). Traces e relatório
    guardam o segredo de bypass da Vercel e o `x-e2e-secret`, e qualquer usuário logado baixa
    artefatos de repositório público. Para investigar, reproduza localmente ou leia o log do run.
- Local: `npx playwright show-report` abre o relatório HTML de `playwright-report/` (gerado com
  `CI=1`); `npx playwright show-trace <arquivo>.zip` abre um trace de `test-results/`.

---

## 6. Gerar a documentação interativa (`docs:gerar`)

```bash
npm run docs:gerar
```

Roda os cenários `@doc` no projeto `desktop`, sempre com um app **local novo** (banco em memória
limpo), tira um screenshot por passo e grava `<ajuda>/<CTX>/<ID>.json` + `<ajuda>/<CTX>/<ID>/NN.png`
(`ajuda` no `tests/e2e/cenarios.config.json`; no template,
`examples/walking-skeleton/docs/ajuda`). O app serve as páginas em `/ajuda`, separadas por perfil.

- **Só contra o app local.** Nunca rode com `E2E_BASE_URL` apontando para um ambiente remoto: as
  capturas sairiam com dados do ambiente e o comando não recusa sozinho.
- Rode antes de abrir/atualizar o PR e **commite** `docs/ajuda` na feature branch (nunca há escrita
  na `main` fora de PR). O `check:cenarios` acusa cenário `@doc` sem página ou com passos
  diferentes.
- Elementos com `data-sensivel` saem tarjados; a captura falha se o valor de um segredo
  (`E2E_*SECRET*`, `E2E_PAT_*`, `DEV_PERSONAL_TOKEN`, `E2E_<PERFIL>_SENHA`) aparecer na tela ou num
  campo.
- Screenshots não são comparados por pixel; o check confere a página e os passos.

---

## 7. Ligar o alvo preview (projeto com UAT)

Execute o runbook [`e2e-uat-configurar.md`](../runbooks/e2e-uat-configurar.md) (usuários de teste,
PATs, segredos do GitHub, `E2E_FAULTS_SECRET` no Preview, `E2E_TARGET=preview`). Limitações
conhecidas:

- **PR de fork** não recebe segredos: no modo preview o job falha com erro explícito; o PR precisa
  vir de uma branch do repositório.
- **Rate limit em memória**: o RNF-SEG-005 pressupõe uma instância quente por preview.
- **Espera do Preview**: até ~15 min (`scripts/e2e/wait-preview.mjs`); deploy com erro ou timeout
  deixa o check vermelho com a mensagem.

---

## Ver Também

- [ADR-016](../adr/template/016-testes-e2e-nascidos-da-spec.md) — a decisão
- [Guia de testes](./testing-guide.md) — unit e integração
- [`docs/rnf.md`](../rnf.md) — baseline do projeto
- [Runbook `deploy-uat.md`](../runbooks/deploy-uat.md) — aguardar `Regressão (UAT)` antes de liberar o UAT
