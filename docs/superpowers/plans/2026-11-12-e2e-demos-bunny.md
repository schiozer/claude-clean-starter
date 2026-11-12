# Demos e treinamento no Bunny (toggle `DEMOS_BUNNY`) — Plano 2 de 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a cada Release, com `DEMOS_BUNNY=on`, o job `Demos & Treinamento` grava em vídeo os cenários `@demo` da versão e todos os `@treinamento` contra o app do commit da tag, publica no Bunny Stream (coleção `vX.Y.Z` e coleção "Treinamento" substituída), grava o catálogo no Bunny Storage (`catalogo/vX.Y.Z.json` antes do `catalogo/index.json`) e a `/ajuda` do skeleton incorpora os vídeos, ou mostra o aviso "vídeos indisponíveis no momento" quando não consegue ler o catálogo.

**Architecture:** tooling puro em `scripts/demos/` (`.mjs` + JSDoc): `IVideoHost` (Bunny Stream + fake), armazenamento do catálogo (Bunny Storage + fake), seleção dos cenários da tag e o orquestrador `publicarDemos`, que é testado de ponta a ponta com os fakes. A gravação reaproveita a `jornada()` do Plano 1: um gancho **antes** do passo injeta a legenda e o destaque do clique, e um reporter do Playwright lista os vídeos. O workflow `demos-treinamento.yml` liga tudo. No skeleton, o módulo `ajuda` ganha um leitor do catálogo pela CDN (cache de 5 min) e os embeds do Bunny (público ou assinado).

**Tech Stack:** Node 20, Playwright (`video: 'on'`, `slowMo`, reporter próprio), Vitest, Next.js 15 (skeleton), Zod, GitHub Actions, Bunny Stream API e Bunny Storage API (via `fetch` injetável).

**Spec:** `docs/superpowers/specs/2026-11-09-e2e-regressao-docs-design.md` (§8.3, §9.1 último item, §9.2, §9.3, §10 ADR-017, CA-1, CA-6, CA-8)

## Global Constraints

- Todas as do Plano 1 (`docs/superpowers/plans/2026-11-10-e2e-regressao-docs.md`, Global Constraints): pt-BR, Prettier, `.mjs` com JSDoc, testes em `tests/unit/*.test.ts`, nunca push na `main`.
- Toggle: variável de repositório **`DEMOS_BUNNY`**, ligada só com o valor exato `on`, no mesmo padrão do `SPEC_GATE`. Quando desligada, o job **sai verde com aviso**. Ele não é pulado: o toggle é checado num passo, não no `if:` do job.
- Nome do workflow e do job: **`Demos & Treinamento`**. Não entra em `requiredChecks`, porque não é check de PR.
- Disparo: `workflow_run` do workflow `Release` com `conclusion == 'success'`, mais `workflow_dispatch` com o input `tag` (obrigatório, `vX.Y.Z`). `concurrency: { group: demos-treinamento, cancel-in-progress: false }`.
- A gravação é sempre contra o app construído no runner a partir do commit da tag, pelo `webServer` do Playwright (`APP_ENV=e2e`). Nunca contra UAT ou Prod: o workflow não define `E2E_BASE_URL`.
- Coleções no Bunny Stream: `vX.Y.Z` (uma por versão, criada com `ensureCollection`) e **`Treinamento`** (substituída a cada versão com `replaceCollection`).
- Catálogo no Bunny Storage: `catalogo/vX.Y.Z.json` (imutável) e depois `catalogo/index.json`. O índice é sempre o último arquivo gravado.
- Segredos (GitHub, R2 pelo runbook): `BUNNY_STREAM_API_KEY`, `BUNNY_LIBRARY_ID`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD` e o opcional `BUNNY_STORAGE_HOST` (padrão `storage.bunnycdn.com`). No app (Vercel): `DEMOS_BUNNY`, `BUNNY_CATALOGO_URL` (URL pública da CDN para `catalogo/index.json`) e `BUNNY_STREAM_TOKEN_KEY` (segredo, só para o embed assinado).
- Mensagens de erro e logs nunca contêm o valor de um segredo, só o nome dele.
- Embed: `https://iframe.mediadelivery.net/embed/<libraryId>/<videoId>`. O assinado acrescenta `?token=<sha256hex(tokenKey + videoId + expires)>&expires=<unix s>`, com validade de 3600 s. É público para `usuário final` e assinado para `time interno`.
- Aviso na `/ajuda` (texto exato): **`Vídeos indisponíveis no momento.`** (`role="status"`).
- Cache do índice no app: **300 000 ms**. Timeout da leitura da CDN: **3 000 ms**.

## Review Focus

1. Rodar de novo (`workflow_dispatch`) a mesma tag → nenhum vídeo duplicado na coleção `vX.Y.Z` nem na `Treinamento`, e o catálogo final é o mesmo. `upload` faz upsert por título. Testes nas Tasks 1 e 4.
2. A substituição do treinamento falha no meio (upload ou gravação do catálogo) → a coleção `Treinamento` antiga e o `index.json` antigo continuam valendo, e a nova coleção parcial é apagada. Testes nas Tasks 1 e 4.
3. `index.json` corrompido, com `formato` desconhecido, CDN com 5xx ou passando de 3 s → a `/ajuda/[id]` mostra a documentação e o aviso, sem lançar exceção. Se houver uma cópia em cache ainda válida, ela continua sendo servida. Teste na Task 6.
4. Cenário `time interno` sem `BUNNY_STREAM_TOKEN_KEY` → o vídeo **não** aparece (fail-closed), em vez de cair num embed público. Teste na Task 6.
5. Erro HTTP do Bunny (401 ou 500) → a mensagem tem método, caminho e status, mas não a `AccessKey` nem a senha do storage. Testes nas Tasks 1 e 2.

---

## Mapa de arquivos

```
scripts/demos/video-host.mjs     IVideoHost: BunnyStreamVideoHost + fake in-memory
scripts/demos/catalogo.mjs       storage do catálogo (Bunny Storage + fake) e montagem dos JSON
scripts/demos/selecao.mjs        tag → PR → spec → cenários @demo/@treinamento (puro + API)
scripts/demos/publicar.mjs       publicarDemos() + seção da Release + CLI (tag|selecionar|publicar|aviso)
tests/e2e/support/demos.ts       gancho de legenda/destaque (antes do passo)
tests/e2e/support/demosReporter.ts  reporter: manifesto dos vídeos gravados
tests/e2e/support/jornada.ts     (mod) ganchos 'antes' além de 'depois'
playwright.config.ts             (mod) modo E2E_DEMOS=1
.github/workflows/demos-treinamento.yml
examples/walking-skeleton/src/modules/ajuda/…  catálogo de vídeos, embeds, DTO, UI
docs/adr/template/017-bunny-videos-demos-treinamento.md, docs/runbooks/bunny-habilitar.md, guia
```

---

### Task 1: `IVideoHost` — Bunny Stream e fake

**Files:**

- Create: `scripts/demos/video-host.mjs`
- Test: `tests/unit/demosVideoHost.test.ts`

**Interfaces:**

- Produces:
  - JSDoc `IVideoHost = { ensureCollection(nome: string): Promise<{ id: string }>, replaceCollection<T>(nome: string, preencher: (id: string) => Promise<T>): Promise<T>, upload(input: { colecao: string, titulo: string, arquivo: string }): Promise<{ videoId: string }>, embedUrl(videoId: string): string }`
  - `makeBunnyStreamVideoHost({ apiKey, libraryId, fetchFn = fetch, readFile = fs.promises.readFile }): IVideoHost`
  - `makeFakeVideoHost({ libraryId = 'lib-fake' } = {}): IVideoHost & { ops: string[], colecoes: Map<string, { nome: string, videos: Map<string, string> }> }`. `ops` registra, em ordem, `ensure:<nome>`, `create:<nome>`, `upload:<colecaoNome>:<titulo>`, `delete-video:<titulo>` e `delete-collection:<nome>`. `videos` mapeia videoId → título.
- Semântica (igual no Bunny e no fake):
  - `ensureCollection`: devolve a coleção de nome **exato** se existir; senão, cria.
  - `replaceCollection`: guarda as coleções de mesmo nome que já existem, cria uma nova e chama `preencher(novaId)`. Se der certo, apaga os vídeos e depois as coleções antigas, e devolve o resultado. Se `preencher` lançar, apaga a coleção **nova** (com os vídeos dela) e relança; as antigas ficam intactas.
  - `upload`: cria o vídeo na coleção e envia os bytes. **Depois** apaga os vídeos mais antigos de mesmo título naquela coleção (upsert).
  - `embedUrl`: `https://iframe.mediadelivery.net/embed/<libraryId>/<videoId>`.
- Bunny Stream (base `https://video.bunnycdn.com/library/<libraryId>`, header `AccessKey: <apiKey>`, JSON):
  - `GET /collections?search=<nome>&itemsPerPage=100` → `{ items: [{ guid, name }] }`;
  - `POST /collections {name}` → `{ guid }`;
  - `DELETE /collections/<id>`;
  - `GET /videos?collection=<id>&search=<titulo>&itemsPerPage=100` → `{ items: [{ guid, title }] }`, e sem `search` para listar tudo;
  - `POST /videos {title, collectionId}` → `{ guid }`;
  - `PUT /videos/<guid>` com os bytes (`content-type: application/octet-stream`);
  - `DELETE /videos/<guid>`.
  - Resposta não 2xx → `Error('bunny-stream: <MÉTODO> <caminho> → <status>')`.

- [ ] **Step 1: Write the failing tests** (`describe('makeFakeVideoHost')` e `describe('makeBunnyStreamVideoHost')`, com o `fetchFn` gravando as chamadas)
  - `ensureCollection('v1.2.0')` duas vezes → mesmo `id`; `ops` = `['ensure:v1.2.0', 'create:v1.2.0', 'ensure:v1.2.0']`.
  - `upload` duas vezes com o mesmo título na mesma coleção → a coleção fica com 1 vídeo, que é o segundo `videoId`.
  - `replaceCollection('Treinamento', cb)` com uma `Treinamento` antiga que tem 2 vídeos → `cb` recebe um id diferente do antigo. Depois disso só existe a coleção nova, e `ops` termina com `delete-video` ×2 e `delete-collection:Treinamento`, **depois** dos uploads feitos no `cb`.
  - `cb` lança `Error('x')` → `rejects.toThrow('x')`; a antiga continua com 2 vídeos e a nova não existe.
  - Bunny: `ensureCollection` com `items` contendo `'v1.2.0-rc'` e `'v1.2.0'` escolhe o nome exato; sem nome exato, faz `POST /collections`.
  - Bunny: `upload` faz `POST /videos`, depois `PUT /videos/<guid>` com os bytes de `readFile` e depois `DELETE` só do guid antigo de mesmo título.
  - Bunny: toda chamada leva o header `AccessKey`; `fetchFn` com 401 → a mensagem bate com `/^bunny-stream: GET \/library\/\d+\/collections.* → 401$/` e `not.toContain(apiKey)`.
  - `embedUrl('abc')` → `'https://iframe.mediadelivery.net/embed/<libraryId>/abc'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/demosVideoHost.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implement** `scripts/demos/video-host.mjs` com as duas factories acima. O fake gera ids `col-<n>` e `vid-<n>`.
- [ ] **Step 4: Run** o mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(demos): ivideohost com bunny stream e fake in-memory`

### Task 2: Catálogo — armazenamento e montagem

**Files:**

- Create: `scripts/demos/catalogo.mjs`
- Test: `tests/unit/demosCatalogo.test.ts`

**Interfaces:**

- Produces:
  - JSDoc `IArmazenamento = { ler(caminho: string): Promise<string | null>, gravar(caminho: string, conteudo: string): Promise<void> }`
  - `makeBunnyStorage({ zona, senha, host = 'storage.bunnycdn.com', fetchFn = fetch }): IArmazenamento`. Faz `GET`/`PUT` em `https://<host>/<zona>/<caminho>` com o header `AccessKey: <senha>`. `PUT` com `content-type: application/json`. `GET` com 404 → `null`; outro status não 2xx → `Error('bunny-storage: <MÉTODO> <caminho> → <status>')`.
  - `makeFakeStorage(): IArmazenamento & { ops: string[], arquivos: Map<string, string> }`. `ops` registra `ler:<caminho>` e `gravar:<caminho>`.
  - Tipos (JSDoc, a fonte do formato; o skeleton os espelha em Zod na Task 6):
    - `VideosDoCenario = { desktop?: string, mobile?: string }` (videoIds);
    - `ItemDoCatalogo = { id, titulo, contexto, perfil: 'usuário final' | 'time interno', videos: VideosDoCenario }`;
    - `CatalogoVersao = { formato: 1, versao, geradoEm, libraryId, spec: string | null, demos: ItemDoCatalogo[] }`;
    - `CatalogoIndice = { formato: 1, atualizadoEm, libraryId, versoes: string[], demos: Record<string, ItemDoCatalogo & { versao: string }>, treinamento: { versao: string, trilhas: { perfil, itens: ItemDoCatalogo[] }[] } | null }`.
  - `CAMINHO_INDICE = 'catalogo/index.json'`; `caminhoDaVersao(versao) => 'catalogo/<versao>.json'`.
  - `lerIndice(texto: string | null): CatalogoIndice | null`. Devolve `null` para ausente, JSON inválido ou `formato !== 1`.
  - `montarIndice({ anterior: CatalogoIndice | null, versao: CatalogoVersao, treinamento: ItemDoCatalogo[], agora: Date }): CatalogoIndice`. Regras:
    - `versoes` sem repetição, em ordem SemVer decrescente;
    - `demos` = as do anterior sobrescritas pelas da versão (por `id`);
    - `treinamento.trilhas` agrupa por perfil, `usuário final` antes de `time interno`, com os itens ordenados por `id`. Se `treinamento` vier vazio, fica `{ versao, trilhas: [] }`.

- [ ] **Step 1: Write the failing tests**
  - `montarIndice` com um anterior que tem `versoes: ['v1.1.0']` e a demo `CT-RES-001@v1.1.0`, mais uma versão `v1.2.0` com `CT-RES-001` e `CT-RES-006` → `versoes` igual a `['v1.2.0','v1.1.0']`, `demos['CT-RES-001'].versao === 'v1.2.0'`, e as duas chaves estão presentes.
  - `montarIndice` com `versoes: ['v1.10.0','v1.9.0']` anteriores e a versão `v1.2.0` → `['v1.10.0','v1.9.0','v1.2.0']` (SemVer, não ordem lexical).
  - Trilhas: itens `time interno` CT-RES-006 e `usuário final` CT-RES-003 e CT-RES-001 → a ordem das trilhas é `usuário final` → `time interno`, e os itens da 1ª são `['CT-RES-001','CT-RES-003']`.
  - `lerIndice('{')` → `null`; `lerIndice('{"formato":2}')` → `null`; `lerIndice(null)` → `null`.
  - `makeBunnyStorage`: `gravar('catalogo/index.json', '{}')` → `PUT https://storage.bunnycdn.com/zona/catalogo/index.json` com `AccessKey`; `ler` com 404 → `null`; 500 → a mensagem bate com `/^bunny-storage: GET catalogo\/index.json → 500$/` e `not.toContain(senha)`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/demosCatalogo.test.ts` → FAIL.
- [ ] **Step 3: Implement** `scripts/demos/catalogo.mjs`.
- [ ] **Step 4: Run** o mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(demos): catálogo de vídeos no bunny storage`

### Task 3: Gravação — legenda, destaque e manifesto dos vídeos

**Files:**

- Modify: `tests/e2e/support/jornada.ts` (ganchos `antes`), `tests/e2e/support/index.ts` (registra a legenda com `E2E_DEMOS=1`), `playwright.config.ts` (modo demos), `package.json` (script `demos:gravar`; `.e2e/` já está no `.gitignore`)
- Create: `tests/e2e/support/demos.ts`, `tests/e2e/support/demosReporter.ts`
- Test: `tests/unit/e2eDemos.test.ts`; `tests/e2e/support/jornada.selftest.spec.ts` (caso novo para `antes`)

**Interfaces:**

- Consumes: `PassoCtx`, `GanchoDePasso` e `registrarGanchoDePasso` (Plano 1).
- Produces:
  - `registrarGanchoDePasso(fn: GanchoDePasso, opts?: { momento?: 'antes' | 'depois' }): () => void`. O padrão é `'depois'`, então o comportamento atual não muda. O gancho `antes` roda dentro do `test.step`, antes de `executar()`.
  - `demos.ts`:
    - `LEGENDA_ID = 'e2e-legenda'`;
    - `CHAVE_LEGENDA = 'e2e-legenda'` (sessionStorage);
    - `ehCenarioDeVideo(c: Cenario): boolean`, verdadeiro com `@demo` ou `@treinamento`;
    - `instalarLegenda(): void`, uma função autocontida, passada a `addInitScript`/`evaluate`. Ela:
      - cria (uma vez) um `div#e2e-legenda` fixo no rodapé, com `aria-hidden="true"` e `pointer-events: none`, cujo texto vem de `sessionStorage[CHAVE_LEGENDA]`;
      - registra (uma vez) um `pointerdown` em captura que aplica `outline: 3px solid` ao `event.target` por 800 ms.
    - `makeGanchoDeLegenda(): GanchoDePasso`. Só age em cenário de vídeo com `page`. No `indice === 0`, chama `page.addInitScript(instalarLegenda)` e `page.evaluate(instalarLegenda)`. Em todo passo, chama `page.evaluate` gravando `` `${palavra} ${texto}` `` em `sessionStorage` e atualizando o texto do div.
  - `demosReporter.ts`: `export default class DemosReporter implements Reporter`, com `constructor({ saida = '.e2e/demos/manifesto.json' } = {})`.
    - `onTestEnd(test, result)`: extrai o ID de `test.title` (`/CT-[A-Z]{2,6}-\d{3}/`) e o projeto de `test.parent.project()?.name`. Pega o anexo `name === 'video'` (`path`). Guarda `{ id, projeto, arquivo, ok: result.status === 'passed' }`. Teste sem ID ou sem vídeo é ignorado.
    - `onEnd()`: grava `{ videos: Entrada[] }` em `saida`, criando a pasta.
  - `playwright.config.ts`, quando `process.env.E2E_DEMOS === '1'`:
    - `use.video = 'on'`, `use.launchOptions = { slowMo: 500 }`;
    - `retries: 0`;
    - reporter `[['list'], ['./tests/e2e/support/demosReporter.ts']]`;
    - `reuseExistingServer: false`.
    - Fora do modo demos, nada muda.
  - `package.json`: `"demos:gravar": "E2E_DEMOS=1 playwright test --project=desktop --project=mobile"`. O workflow acrescenta `--grep`.

- [ ] **Step 1: Write the failing tests** (`tests/unit/e2eDemos.test.ts`, com uma `page` fake que registra `addInitScript`/`evaluate`, como no `e2eDocs.test.ts`)
  - `makeGanchoDeLegenda` num cenário só `@doc` → nenhuma chamada na page.
  - Num cenário `@demo`, passo `indice: 0` → `addInitScript` ×1 com `instalarLegenda`, depois `evaluate` com o texto `'Quando abro a lista de recursos'`. No `indice: 1`, nenhum `addInitScript` novo.
  - `instalarLegenda` rodada 2× num `happy-dom` (`// @vitest-environment happy-dom`) → só um `#e2e-legenda`, com `aria-hidden="true"` e o texto do `sessionStorage`.
  - `DemosReporter`: os testes `'CT-RES-001 — Criar…'` (`desktop`, passed, com vídeo), `'CT-RES-001 …'` (`mobile`, failed, com vídeo) e `'sem id'` geram um manifesto com 2 entradas (`ok: true` e `ok: false`) num diretório temporário.
  - Selftest Playwright: `registrarGanchoDePasso(fn, { momento: 'antes' })` registra `antes:0` antes do efeito do passo 0. A ordem esperada é `['antes:0','efeito:0','depois:0','antes:1', …]`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/e2eDemos.test.ts` → FAIL.
- [ ] **Step 3: Implement** `demos.ts`, `demosReporter.ts` e o `momento` em `jornada.ts`. Em `index.ts`, com `E2E_DEMOS === '1'`, chamar `registrarGanchoDePasso(makeGanchoDeLegenda(), { momento: 'antes' })`. Depois aplicar as mudanças do config e do `package.json`.
- [ ] **Step 4: Run** `npx vitest run tests/unit/e2eDemos.test.ts && npm run type-check && npx playwright test tests/e2e/support/jornada.selftest.spec.ts` → PASS.
- [ ] **Step 5: Run** `npm run demos:gravar -- --grep CT-RES-001` → saem 2 vídeos `.webm` em `test-results/` e o `.e2e/demos/manifesto.json` com 2 entradas `ok: true`. Ver o vídeo do desktop e confirmar a legenda no rodapé.
- [ ] **Step 6: Commit** `feat(e2e): gravação de demos com legenda e manifesto de vídeos`

### Task 4: Seleção da versão e publicação

**Files:**

- Create: `scripts/demos/selecao.mjs`, `scripts/demos/publicar.mjs`
- Modify: `package.json` (script `demos:publicar`: `node scripts/demos/publicar.mjs`)
- Test: `tests/unit/demosSelecao.test.ts`, `tests/unit/demosPublicar.test.ts`

**Interfaces:**

- Consumes:
  - `IVideoHost` e os fakes (Task 1);
  - `IArmazenamento`, `montarIndice`, `lerIndice`, `caminhoDaVersao` e `CAMINHO_INDICE` (Task 2);
  - `parseSpecLine` (`scripts/pr-gate.mjs`), `makeReleaseApi` (`scripts/release.mjs`, para `tags()` e `pullsForCommit()`), `makeGithubClient` (`scripts/github-api.mjs`) e `loadIndice(root)` (`scripts/e2e/config.mjs`).
- Produces:
  - `selecao.mjs`:
    - `tagDoCommit(tags: {name, sha}[], sha): string | null`, só tags `vX.Y.Z`;
    - `async specDaTag(api, tag): { versao, sha, spec: string | null }`. A spec vem do PR mergeado na `main` ligado ao sha da tag; `parseSpecLine` de kind `path` dá a spec, e qualquer outro caso dá `null`. Tag inexistente → `Error('demos: tag <tag> não encontrada')`;
    - `selecionarCenarios({ cenarios: Cenario[], spec: string | null }): { demos: Cenario[], treinamento: Cenario[] }`. `demos` são os `@demo` cujo `path === spec`; `treinamento` são todos os `@treinamento`. Os dois excluem `aposentado` e vêm ordenados por `id`;
    - `grepDe(sel): string`, os IDs únicos unidos por `|`, ou `''`.
    - Arquivo `Selecao = { versao, spec, demos: ItemSelecionado[], treinamento: ItemSelecionado[] }`, com `ItemSelecionado = { id, titulo, contexto, perfil }` (perfil nulo vira `'usuário final'`), salvo em `.e2e/demos/selecao.json`.
  - `publicar.mjs`:
    - `async publicarDemos({ selecao, manifesto, host, storage, libraryId, agora }): Promise<{ catalogo: CatalogoVersao, indice: CatalogoIndice }>`. A ordem é fixa:
      1. confere que todo item selecionado tem ≥ 1 entrada `ok: true` no manifesto; senão lança `Error('demos: sem vídeo gravado para <ids>')` **antes de qualquer upload**;
      2. se houver demos, `ensureCollection(versao)` e `upload` de cada vídeo, com título `<id> — <titulo> (<projeto>)`;
      3. `replaceCollection('Treinamento', async (id) => { … })`, que faz upload do treinamento, `gravar(caminhoDaVersao(versao))`, `ler(CAMINHO_INDICE)` → `lerIndice` → `montarIndice` e `gravar(CAMINHO_INDICE)`.
    - `notasDasDemos(catalogo, host): string`: começa por `<!-- demos -->\n### Demos\n`, com uma linha `- [<id> — <titulo>](<embedUrl do desktop, senão mobile>)` por demo, ou `Nenhuma demo nesta versão.`;
    - `avisoDeFalha(runUrl): string`: `<!-- demos -->\n### Demos\n⚠️ A publicação das demos falhou ([run](<runUrl>)). Rode de novo em Actions → Demos & Treinamento → Run workflow, com a tag.`;
    - `comSecaoDeDemos(corpo, secao): string`: substitui do marcador `<!-- demos -->` até o fim, ou acrescenta com uma linha em branco antes;
    - CLI `node scripts/demos/publicar.mjs <cmd>`, com `GITHUB_TOKEN`/`GITHUB_REPOSITORY` e saídas em `GITHUB_OUTPUT`:
      - `tag` (env `HEAD_SHA`) → `tag=<vX.Y.Z>` ou `tag=` com `::warning::`;
      - `selecionar` (env `TAG`) → grava `selecao.json` e `grep=<…>`;
      - `publicar` (env `TAG`, segredos `BUNNY_*`) → `publicarDemos` e `PATCH` do corpo da Release (`GET /releases/tags/<tag>` → `PATCH /releases/<id>`);
      - `aviso` (env `TAG`, `RUN_URL`) → `PATCH` com `avisoDeFalha`.
      - Segredo ausente → `Error('demos: defina <NOME>')`.

- [ ] **Step 1: Write the failing tests**
  - `selecionarCenarios`: há um `@demo` em `specs/a.md`, um `@demo` em `specs/b.md`, um `@treinamento` em `b.md` e um `@demo @treinamento` aposentado; com `spec = 'specs/a.md'` → `demos` = [o de a], `treinamento` = [o de b]. Com `spec = null` → `demos` = [].
  - `specDaTag`, com a API fake: PR com `Spec: n/a — refactor` → `spec: null`; PR com `Spec: docs/superpowers/specs/x.md` → esse caminho; tag inexistente → rejeita com `'demos: tag v9.9.9 não encontrada'`.
  - `publicarDemos` (CA-6) com `makeFakeVideoHost`, `makeFakeStorage`, 1 demo (desktop + mobile) e 1 treinamento, mais uma `Treinamento` e um `index.json` antigos já semeados. Os índices em `host.ops`/`storage.ops` têm de respeitar esta ordem: `ensure:v1.2.0` < `upload:v1.2.0:…` < `create:Treinamento` < `upload:Treinamento:…` < `gravar:catalogo/v1.2.0.json` < `gravar:catalogo/index.json` < `delete-collection:Treinamento`. O índice gravado tem `versoes[0] === 'v1.2.0'` e mantém as demos do índice antigo.
  - Rodar 2× a mesma seleção → 2 vídeos na coleção `v1.2.0` (desktop + mobile, sem duplicata) e 1 coleção `Treinamento`.
  - Manifesto sem vídeo `ok` para o treinamento → rejeita com `'demos: sem vídeo gravado para CT-RES-001'`, e `host.ops`/`storage.ops` ficam vazios.
  - `storage.gravar` lança ao gravar o índice → rejeita; a `Treinamento` antiga continua lá e o `index.json` antigo fica igual.
  - `comSecaoDeDemos('corpo\n<!-- demos -->\nvelho', 'S')` → `'corpo\nS'`; `comSecaoDeDemos('corpo', 'S')` → `'corpo\n\nS'`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/demosSelecao.test.ts tests/unit/demosPublicar.test.ts` → FAIL.
- [ ] **Step 3: Implement** `selecao.mjs` e `publicar.mjs`, com o guard de `isMain` no padrão de `release.mjs`.
- [ ] **Step 4: Run** o mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(demos): seleção da versão e publicação no bunny com catálogo`

### Task 5: Workflow `Demos & Treinamento`

**Files:**

- Create: `.github/workflows/demos-treinamento.yml`
- Test: `tests/unit/demosWorkflow.test.ts` (leitura do YAML como texto, no padrão de `specGate.test.ts`)

**Interfaces:**

- Consumes: os subcomandos `tag`, `selecionar`, `publicar` e `aviso` (Task 4) e `npm run demos:gravar` (Task 3).
- Produces: o workflow `name: Demos & Treinamento`, com um job `demos` de `name: Demos & Treinamento`, `timeout-minutes: 60` e `permissions: { contents: write, pull-requests: read }`. Os passos, em ordem:
  1. **Toggle**: se `vars.DEMOS_BUNNY != 'on'`, `::warning::` e resumo `Demos & Treinamento desligado (DEMOS_BUNNY) — ver docs/runbooks/bunny-habilitar.md`, saída `ligado=false`. Todos os passos seguintes ficam com `if: steps.toggle.outputs.ligado == 'true'`.
  2. `if:` do job: `github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'`.
  3. Checkout padrão (scripts) e depois `publicar.mjs tag`. A tag vem de `inputs.tag` no dispatch, ou de `HEAD_SHA = github.event.workflow_run.head_sha`. Se a tag ficar vazia, os passos seguintes param e o job fica verde com aviso.
  4. Checkout com `ref: <tag>` e `fetch-depth: 0`. Depois `npm ci`, `npm ci` do skeleton e `npx playwright install --with-deps chromium`.
  5. `publicar.mjs selecionar`; com `grep` vazio, aviso "nenhum cenário @demo/@treinamento" e fim verde.
  6. `npm run demos:gravar -- --grep "$GREP"`, com `CI: '1'` e **sem** `E2E_BASE_URL`.
  7. `publicar.mjs publicar`, com os segredos `BUNNY_*` em `env`.
  8. `if: failure() && steps.tag.outputs.tag != ''` → `publicar.mjs aviso`, com `RUN_URL`.
  9. Upload do `.e2e/demos/` e `test-results/` como artefato por 7 dias (`if: always()`).

- [ ] **Step 1: Write the failing tests** (asserções sobre o texto do YAML)
  - Contém `workflow_run:` com `workflows: [Release]` e `types: [completed]`, mais `workflow_dispatch:` com o input `tag` `required: true`.
  - `concurrency` tem `group: demos-treinamento` e `cancel-in-progress: false`.
  - O `if:` do job **não** menciona `DEMOS_BUNNY` (`/jobs:[\s\S]*?\n    if:[^\n]*DEMOS_BUNNY/` não casa), e um passo contém `vars.DEMOS_BUNNY != 'on'` e `::warning::`.
  - Não contém `E2E_BASE_URL`; contém `ref: ${{ steps.tag.outputs.tag }}`.
  - Contém `if: failure()` seguido de `publicar.mjs aviso`.
  - Cada segredo `BUNNY_STREAM_API_KEY`, `BUNNY_LIBRARY_ID`, `BUNNY_STORAGE_ZONE` e `BUNNY_STORAGE_PASSWORD` aparece só como `secrets.<NOME>`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/demosWorkflow.test.ts` → FAIL.
- [ ] **Step 3: Implement** `.github/workflows/demos-treinamento.yml`, com comentário de cabeçalho no estilo do `e2e-regressao.yml` (por que `workflow_run`: Release criada com `GITHUB_TOKEN` não dispara `release: published`).
- [ ] **Step 4: Run** o mesmo comando → PASS; `npx prettier --check .github/workflows/demos-treinamento.yml` → ok.
- [ ] **Step 5: Commit** `ci(demos): job demos & treinamento atrás do toggle demos_bunny`

### Task 6: Skeleton — catálogo de vídeos no service da ajuda

**Files:**

- Create:
  - `examples/walking-skeleton/src/modules/ajuda/application/IVideosDaAjuda.ts`
  - `examples/walking-skeleton/src/modules/ajuda/application/catalogo.ts` (schema Zod do índice)
  - `examples/walking-skeleton/src/modules/ajuda/infrastructure/CdnCatalogoDeVideos.ts`
  - `examples/walking-skeleton/src/modules/ajuda/infrastructure/BunnyEmbeds.ts`
- Modify: `application/AjudaService.ts`, `application/dto.ts`, `index.ts`, `src/composition.ts`, `examples/walking-skeleton/.env.local.example`
- Test: `examples/walking-skeleton/tests/unit/CdnCatalogoDeVideos.test.ts`, `BunnyEmbeds.test.ts`; `AjudaService.test.ts` (casos novos)

**Interfaces:**

- Consumes: o formato `CatalogoIndice` (Task 2), espelhado em Zod.
- Produces:
  - `catalogoIndiceSchema` (Zod, `formato: z.literal(1)`, campos da Task 2) e `type CatalogoIndice`;
  - `IVideosDaAjuda { indice(): Promise<CatalogoIndice | null> }`. `null` significa indisponível, e ele nunca lança;
  - `IEmbeds { url(videoId: string, opts: { assinado: boolean }): string | null }`;
  - `CdnCatalogoDeVideos({ url, fetchFn = fetch, clock, ttlMs = 300_000, timeoutMs = 3_000 })`. Faz cache do último índice válido por `ttlMs`. Erro, timeout, status não 2xx ou schema inválido → devolve o cache se ainda estiver dentro do `ttlMs`; senão, `null` e `logError('ajuda:catalogo', erro)`;
  - `BunnyEmbeds({ libraryId, tokenKey, clock })`:
    - `assinado: false` → URL pública (Global Constraints);
    - `assinado: true` com `tokenKey` → URL com `token`/`expires`, onde `expires = floor(now/1000) + 3600`;
    - `assinado: true` sem `tokenKey` → `null`.
    - O `libraryId` sai do próprio índice: `BunnyEmbeds` é criado por índice, pela factory `makeEmbeds(libraryId)`, que o service recebe.
  - `AjudaDocDTO.videos: VideosDaAjuda`, com:
    - `{ estado: 'desligado' }`;
    - `{ estado: 'indisponivel' }`;
    - `{ estado: 'ok', demo: { versao, embedUrl, titulo } | null, treinamento: { id, titulo, embedUrl }[] }`.
    - A `list()` devolve sempre `videos: { estado: 'desligado' }`: só a página do cenário lê o catálogo.
  - `new AjudaService(source, videos: IVideosDaAjuda | null = null, makeEmbeds: (libraryId: string) => IEmbeds = …)`, com `videos === null` → `desligado`. No `get`:
    - a demo é `indice.demos[id]`, com o desktop e, na falta dele, o mobile. É assinada quando o perfil é `time interno`; se a URL for `null`, a demo fica `null`;
    - o treinamento junta as trilhas que o ator pode ver: `usuário final` sempre, `time interno` só com `ajuda:interno`. Itens sem URL são omitidos.
  - `composition.ts`: `videos` só com `process.env.DEMOS_BUNNY === 'on'` **e** `BUNNY_CATALOGO_URL`; o token vem de `BUNNY_STREAM_TOKEN_KEY`. Comentário de que a ajuda segue sem tool MCP.

- [ ] **Step 1: Write the failing tests**
  - `CdnCatalogoDeVideos`:
    - fetch 200 com índice válido → objeto; uma 2ª chamada dentro de 300 000 ms → `fetchFn` chamado 1×;
    - fetch 500 depois de expirar e sem cache válido → `null`;
    - dentro do TTL com um refetch forçado que falha → serve o cache;
    - `'{"formato":2}'` → `null`;
    - `fetchFn` que nunca resolve → `null` em ≤ 3 000 ms (com timers falsos).
  - `BunnyEmbeds`: `url('vid', {assinado:false})` → `'https://iframe.mediadelivery.net/embed/lib/vid'`. Assinado com `tokenKey='k'` e relógio em `1_700_000_000_000` → `expires=1700003600` e `token = sha256hex('k' + 'vid' + '1700003600')`. Sem `tokenKey` → `null`.
  - `AjudaService.get`:
    - sem `videos` → `estado: 'desligado'`;
    - `videos.indice()` → `null` → `estado: 'indisponivel'`, e o resto do DTO fica igual ao de hoje;
    - demo `time interno` sem `tokenKey` → `demo: null`;
    - ator sem `ajuda:interno` → nenhum item da trilha `time interno` em `treinamento`;
    - `usuário final` → `embedUrl` público.
- [ ] **Step 2: Run** `npm --prefix examples/walking-skeleton test -- CdnCatalogoDeVideos BunnyEmbeds AjudaService` → FAIL.
- [ ] **Step 3: Implement** os arquivos acima. Acrescentar ao `.env.local.example`: `DEMOS_BUNNY=`, `BUNNY_CATALOGO_URL=` e `BUNNY_STREAM_TOKEN_KEY=`, com comentário apontando para o runbook.
- [ ] **Step 4: Run** `npm --prefix examples/walking-skeleton test && npm --prefix examples/walking-skeleton run type-check` → PASS.
- [ ] **Step 5: Commit** `feat(ajuda): catálogo de vídeos do bunny no service da ajuda`

### Task 7: Skeleton — vídeos na página da ajuda e cenário do aviso

**Files:**

- Create: `examples/walking-skeleton/src/ui/components/AjudaVideos.tsx`
- Modify: `AjudaPassoAPasso.tsx` (renderiza `<AjudaVideos videos={doc.videos} />` depois do passo a passo), `examples/walking-skeleton/docs/specs/ajuda.md` (CT-AJU-002 e um CA novo), `playwright.config.ts` (env do `webServer` local: `DEMOS_BUNNY: 'on'` e `BUNNY_CATALOGO_URL: 'http://127.0.0.1:9/catalogo/index.json'`), `examples/walking-skeleton/next.config.mjs` (acrescentar `"frame-src https://iframe.mediadelivery.net"` à `csp()`; o `default-src 'self'` bloquearia o iframe; o catálogo é lido no servidor, sem `connect-src`)
- Create: `examples/walking-skeleton/tests/e2e/ajuda/videos.spec.ts`
- Test: `examples/walking-skeleton/tests/unit/AjudaVideos.test.tsx`

**Interfaces:**

- Consumes: `VideosDaAjuda` (Task 6) e `jornada`/`dado` (Plano 1).
- Produces: `AjudaVideos({ videos }: { videos: VideosDaAjuda })`, que renderiza:
  - `desligado` → nada;
  - `indisponivel` → `<p role="status" className="ajuda-aviso">Vídeos indisponíveis no momento.</p>`;
  - `ok` → `<section aria-labelledby="ajuda-videos-titulo">` com `<h2 id="ajuda-videos-titulo">Vídeos</h2>`, um `<iframe title="Demonstração: <titulo>" src=… loading="lazy" allow="encrypted-media; picture-in-picture" allowFullScreen>` quando há demo, e uma lista "Treinamento" com links (`target="_blank" rel="noopener noreferrer"`) quando há itens. Sem demo e sem treinamento, não renderiza nada.
  - CT-AJU-002 (no formato §4.1):

    ```
    ### CT-AJU-002 — Ver a ajuda quando os vídeos estão indisponíveis

    Tipo: @e2e
    Critério: CA-<novo> Perfil: usuário final

    Dado que estou logado como usuário final
    Quando abro a página "Criar um recurso e vê-lo na lista" da ajuda
    Então vejo o passo 1 com o screenshot e a legenda
    E vejo o aviso "Vídeos indisponíveis no momento."
    ```

    O CA novo, no §9 de `ajuda.md`, diz: "Com os vídeos ligados e o catálogo inacessível, a página da ajuda mostra a documentação e o aviso, sem erro."

- [ ] **Step 1: Write the failing tests**
  - `AjudaVideos.test.tsx` (happy-dom + Testing Library):
    - `desligado` → `container` vazio;
    - `indisponivel` → `getByRole('status')` com o texto exato;
    - `ok` com demo → um `iframe` com `title='Demonstração: Criar um recurso e vê-lo na lista'`;
    - `ok` sem demo e sem treinamento → vazio.
  - `videos.spec.ts`: `test('CT-AJU-002 …')` com `jornada('CT-AJU-002', { … }, { page })`, que verifica o passo 1 e `getByRole('status')` com `'Vídeos indisponíveis no momento.'`.
- [ ] **Step 2: Run** `npm --prefix examples/walking-skeleton test -- AjudaVideos` → FAIL.
- [ ] **Step 3: Implement** `AjudaVideos.tsx`, a integração no `AjudaPassoAPasso`, o env do `webServer` e o `frame-src` da CSP. Depois adicionar CT-AJU-002 e o CA na spec.
- [ ] **Step 4: Run** `npm --prefix examples/walking-skeleton test && npm run check:cenarios && npx playwright test --grep "CT-AJU"` → PASS, incluindo o CT-AJU-001 (navegação pelo teclado, que não pode ser atrapalhada pelo aviso).
- [ ] **Step 5: Commit** `feat(ajuda): vídeos da demo e do treinamento na página da ajuda`

### Task 8: ADR-017, runbook `bunny-habilitar`, guia e adoção

**Files:**

- Create: `docs/adr/template/017-bunny-videos-demos-treinamento.md`, `docs/runbooks/bunny-habilitar.md`
- Modify:
  - `docs/runbooks/README.md`: linha no Catálogo;
  - `docs/guides/e2e-guide.md`: seção "Demos e treinamento" e link do ADR-017 em "Ver também";
  - `docs/adr/template/016-testes-e2e-nascidos-da-spec.md`: link para o ADR-017 onde fala de demos;
  - `CLAUDE.md`: bloco de adoção "**Adoção — demos** (ADR-017): `DEMOS_BUNNY` nasce desligado; para ligar, runbook `bunny-habilitar.md`";
  - `template-sync.manifest.json`: os testes novos `tests/unit/demos*.test.ts` e `tests/unit/e2eDemos.test.ts`, em ordem alfabética;
  - `examples/walking-skeleton/docs/specs/resources.md`: CT-RES-001 com `Destino: @doc @demo @treinamento`.
- Test: `npm run check:runbooks`, `tests/unit/docsLinks.test.ts`, `tests/unit/templateSyncManifest.test.ts`

**Interfaces:**

- Consumes: os nomes exatos das Global Constraints (variáveis, segredos, coleções, caminhos do catálogo) e os subcomandos da Task 4.
- Produces:
  - **ADR-017**, no formato de `000-template.md`:
    - Contexto: vídeo escrito no merge, fora do git;
    - Decisão: Bunny Stream atrás de `IVideoHost`; catálogo versionado no Bunny Storage, com o índice gravado por último; embed público ou assinado conforme o perfil; toggle `DEMOS_BUNNY`; gravação contra o app da tag;
    - Consequências;
    - Alternativas: YouTube não listado, S3+CloudFront, commitar os vídeos no git — cada uma com o motivo da recusa.
  - **`bunny-habilitar.md`**, com as seções do `_TEMPLATE` (as mesmas do `e2e-uat-configurar.md`), cada passo com classe de risco:
    - `[R1]` criar a library no Bunny Stream e anotar o `BUNNY_LIBRARY_ID`;
    - `[R1]` criar a storage zone e a pull zone ligada a ela;
    - `[R1]` criar uma Edge Rule de cache de 60 s para `*/catalogo/index.json`;
    - `[R2]` gravar os segredos `BUNNY_*` no GitHub com `gh secret set`, sem nunca colar o valor no chat;
    - `[R2]` habilitar o token authentication da library e gravar `BUNNY_STREAM_TOKEN_KEY` na Vercel;
    - `[R1]` `DEMOS_BUNNY=on` e `BUNNY_CATALOGO_URL` na Vercel;
    - `[R1]` `gh variable set DEMOS_BUNNY --body on`;
    - Verificação final: `workflow_dispatch` com a última tag, depois conferir o `index.json` pela URL da CDN e o vídeo na `/ajuda`;
    - Rollback/desligar: `gh variable delete DEMOS_BUNNY` e `DEMOS_BUNNY` removida na Vercel (a ajuda volta a só documentação), e a nota de que as coleções antigas ficam no Bunny até serem apagadas pelo painel.
    - `Última verificação: AAAA-MM-DD` e `<preencher>` onde couber, no padrão dos outros runbooks.
  - Seção do guia: como marcar `@demo`/`@treinamento`, o que é gravado (legenda, `slowMo`, desktop e mobile), como rodar localmente (`npm run demos:gravar -- --grep CT-…`), como rodar de novo uma versão e o comportamento da `/ajuda` com e sem catálogo.

- [ ] **Step 1: Write** o ADR-017, o runbook e a linha do catálogo de runbooks.
- [ ] **Step 2: Run** `npm run check:runbooks` → ok para `bunny-habilitar.md` (CA-8).
- [ ] **Step 3: Write** a seção do guia, os links (guia, ADR-016, CLAUDE.md), o manifest e o `@treinamento` do CT-RES-001.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run type-check && npm run check:cenarios` → PASS (docsLinks valida os links novos; templateSyncManifest valida as entradas).
- [ ] **Step 5: Commit** `docs(demos): adr-017, runbook bunny-habilitar e guia de demos`
