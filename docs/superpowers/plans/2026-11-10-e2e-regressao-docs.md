# E2E, regressão e documentação nascidos da spec — Plano 1 de 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cenários com ID na spec viram testes Playwright ligados por ID, rodam como suíte regressiva obrigatória em todo PR (check `Regressão (UAT)`) e geram a documentação interativa servida em `/ajuda`.

**Architecture:** parsers puros em `scripts/e2e/` (spec → cenários, `docs/rnf.md` → requisitos/telas, `.spec.ts` → refs estáticas via TypeScript compiler API) alimentam o `check-cenarios` (passo do `PR gate`) e o helper `jornada()` de `tests/e2e/support/`. O Playwright roda na raiz; no template, o `playwright.config.ts` sobe o `examples/walking-skeleton`, que ganha hardening, sessão por cookie no modo `e2e`, timeouts, injeção de lentidão e o módulo `ajuda`. O Plano 2 (demos/treinamento no Bunny, `DEMOS_BUNNY`) parte deste.

**Tech Stack:** Node 20, TypeScript, Playwright (`@playwright/test`, Chromium), `@axe-core/playwright`, Vitest, Next.js 15 (skeleton), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-09-e2e-regressao-docs-design.md`

## Global Constraints

- Português (Brasil) em docs, mensagens, commits; nomes de código em inglês ou português conforme o arquivo vizinho (os helpers de E2E usam português: `jornada`, `dado`, `cenario`).
- Prettier: sem `;`, aspas simples, `printWidth` 100. Scripts da raiz em `.mjs` com JSDoc (padrão de `scripts/pr-gate.mjs`); testes deles em `tests/unit/*.test.ts`.
- ID de cenário: `/^CT-[A-Z]{2,6}-\d{3}$/`; ID de RNF: `/^RNF-[A-Z]{3}-\d{3}$/`; ID de usabilidade: `/^USA-\d{3}$/`; critério: `/^CA-\d+$/`.
- Tipos (um por cenário): `@e2e` `@sistemico` `@rnf` `@usabilidade`. Destinos: `@regressao` `@doc` `@demo` `@treinamento`. `@regressao` é implícito salvo `Fora da regressão: <motivo>`.
- Normalização de passo: remove a palavra inicial `Dado|Quando|Então|E|Mas`, `trim`, colapsa espaços. Acentos, aspas e maiúsculas contam.
- Playwright: só Chromium; projetos `setup`, `sistemico`, `desktop` (1280×800), `mobile` (`devices['iPhone 13']` com `defaultBrowserType: 'chromium'`); CI: `retries: 1`, `failOnFlakyTests: true`, `trace: 'retain-on-failure'`, `video: 'retain-on-failure'`.
- axe: tags `['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']`; falha em `serious`/`critical`.
- Baseline (valores iniciais de `docs/rnf.md`): API ≤ 10 000 ms; UI desiste em 15 000 ms; sessão inativa 8 h, máx. 7 dias; API do caminho feliz < 1 000 ms; LCP mobile < 2 500 ms.
- Nome do check obrigatório: **`Regressão (UAT)`** (exato, inclusive acento e espaço).
- Modo local de E2E: `APP_ENV=e2e` **e** `VERCEL` ausente; fora disso o provider de sessão por cookie não autentica ninguém (fail-closed).
- Injeção de lentidão: header `x-e2e-delay-ms` só com `APP_ENV !== 'production'` **e** header `x-e2e-secret` igual a `E2E_FAULTS_SECRET` (≥ 16 chars); senão ignorado sem efeito nem mensagem.
- Nunca push na `main`; nunca editar `hooks/protect-main` além de `config.json` `requiredChecks` (Task 9).

## Review Focus

1. Spec com bloco de cenário malformado (sem `Tipo:`, passo sem palavra-chave, ID fora do padrão) → o `check-cenarios` reporta `arquivo:linha` e motivo, nunca lança exceção. Teste na Task 1.
2. `jornada()` com chave computada, template literal ou spread → o check falha com "chave de passo não literal" em vez de ignorar. Teste na Task 2.
3. Preview da Vercel nunca fica `success` (build falhou ou não existe) → `Regressão (UAT)` vermelho em ≤ 15 min com mensagem explícita, sem esperar para sempre. Teste na Task 9.
4. Página nova em route group `(grupo)` ou rota dinâmica `[id]` → normalizada (`/x/[id]`, sem o grupo) antes de comparar com as telas do `docs/rnf.md`. Teste na Task 3.
5. `x-e2e-delay-ms` com `APP_ENV=production`, sem segredo ou com segredo curto → nenhum atraso e resposta idêntica à normal. Teste na Task 5.

---

## Mapa de arquivos

```
scripts/e2e/cenarios.mjs        parse de cenários na spec (puro)
scripts/e2e/rnf.mjs             parse de docs/rnf.md (puro)
scripts/e2e/testes.mjs          varredura estática de .spec.ts (typescript)
scripts/e2e/config.mjs          lê tests/e2e/cenarios.config.json + carrega índice de cenários/RNF
scripts/e2e/wait-preview.mjs    espera o deploy Preview do SHA (GitHub Deployments API)
scripts/check-cenarios.mjs      CLI + checkCenarios() + relatório de rastreabilidade
tests/e2e/support/*.ts          jornada, dado, rnf, auth, axe, fixtures (gerenciado)
tests/e2e/baseline/*.spec.ts    RNF + usabilidade do baseline (gerenciado)
tests/e2e/auth.setup.ts         login dos perfis (do projeto)
tests/e2e/cenarios.config.json  caminhos de specs/testes/páginas/ajuda (do projeto)
playwright.config.ts            (do projeto) — no template sobe o skeleton
docs/rnf.md                     baseline (do projeto)
.github/workflows/e2e-regressao.yml
examples/walking-skeleton/…     hardening, sessão e2e, timeouts, ajuda, cenários de exemplo
```

---

### Task 1: Parsers de cenários e de RNF

**Files:**

- Create: `scripts/e2e/cenarios.mjs`, `scripts/e2e/rnf.mjs`
- Test: `tests/unit/e2eCenarios.test.ts`, `tests/unit/e2eRnf.test.ts`

**Interfaces:**

- Produces:
  - `parseCenarios(markdown: string, path: string): { cenarios: Cenario[], erros: Erro[] }`
  - `Cenario = { id, titulo, tipo, destinos: string[], criterios: string[], perfil: 'usuário final' | 'time interno' | null, foraDaRegressao: string | null, aposentado: string | null, passos: { palavra: string, texto: string }[], path, linha }`. `destinos` já inclui `@regressao` implícito.
  - `Erro = { path: string, linha: number, mensagem: string }`
  - `normalizarPasso(s: string): string`
  - `parseRnf(markdown: string, path: string): { requisitos: Requisito[], telas: { rota, nome }[], exclusoes: string[], erros: Erro[] }`
  - `Requisito = { id, categoria, requisito, valor: { numero: number, unidade: 'ms'|'s'|'min'|'h'|'d'|'px' } | null }`; `valorEmMs(r: Requisito): number` (lança se a unidade não for de tempo).

Formato do bloco (spec §4.1): heading `### <ID> — <título>`; linhas `Tipo: … Destino: …`, `Critério: … Perfil: …`, opcionais `Fora da regressão: …` e `Aposentado: …`; passos são as linhas que começam por `Dado|Quando|Então|E|Mas`. Só são lidos os blocos dentro da seção cujo heading começa por `## ` e contém `Cenários de teste`.

Formato do `docs/rnf.md`: tabela `| ID | Categoria | Requisito | Valor |` (Valor = `10000 ms`, `8 h`, `—`); seção `## Telas` com tabela `| Rota | Nome |`; seção `## Exclusões` com lista `- /rota`. Linhas `USA-NNN` usam a mesma tabela, com `Categoria = Usabilidade`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/e2eCenarios.test.ts
const SPEC = `## 8. Cenários de teste

### CT-RES-003 — Publicar um recurso
Tipo: @e2e  Destino: @doc @demo
Critério: CA-2   Perfil: usuário final

Dado que estou logado
Quando abro a lista de recursos
E   publico o recurso "Plano de estudos"
Então vejo o selo "Publicado"
`
it('lê o cenário com @regressao implícito', () => {
  const { cenarios, erros } = parseCenarios(SPEC, 's.md')
  expect(erros).toEqual([])
  expect(cenarios[0]).toMatchObject({
    id: 'CT-RES-003', tipo: '@e2e', destinos: ['@regressao', '@doc', '@demo'],
    criterios: ['CA-2'], perfil: 'usuário final', linha: 3,
  })
  expect(cenarios[0].passos.map((p) => normalizarPasso(`${p.palavra} ${p.texto}`)))
    .toEqual(['que estou logado', 'abro a lista de recursos', 'publico o recurso "Plano de estudos"', 'vejo o selo "Publicado"'])
})
it('Fora da regressão remove @regressao')
it('Aposentado é lido e o cenário não exige passos')
it.each([
  ['sem Tipo', /Tipo/],
  ['ID fora do padrão (CT-R-1)', /ID/],
  ['linha solta que não é passo nem metadado', /passo/],
  ['dois Tipos (@e2e @rnf)', /um tipo/],
])('erro com linha: %s', …) // cada caso: erros[0].linha correta, sem throw
it('ignora blocos ### fora da seção Cenários de teste')
```

```ts
// tests/unit/e2eRnf.test.ts
it('lê requisitos, telas e exclusões') // RNF-TMO-001 → { numero: 10000, unidade: 'ms' }
it('valorEmMs converte 8 h em 28 800 000')
it('valorEmMs lança para px')
it('linha com ID inválido vira erro com linha')
it('valor "—" vira null')
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/e2eCenarios.test.ts tests/unit/e2eRnf.test.ts` — Expected: FAIL (módulos não existem).
- [ ] **Step 3: Implement** os dois módulos (parse por linhas, sem dependências; regexes dos IDs das Global Constraints).
- [ ] **Step 4: Run** o mesmo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(e2e): parsers de cenários da spec e do baseline de rnf`

---

### Task 2: Varredura estática dos testes Playwright

**Files:**

- Create: `scripts/e2e/testes.mjs`
- Test: `tests/unit/e2eTestes.test.ts`

**Interfaces:**

- Consumes: `normalizarPasso` (Task 1).
- Produces: `scanTestes(source: string, path: string): { refs: TesteRef[], erros: Erro[] }`, `TesteRef = { id: string, titulo: string, tags: string[], passos: string[] | null, path, linha }`.

Usa `typescript` (`ts.createSourceFile`) para achar chamadas `test(…)`/`test.describe(…)` cujo 1º argumento é string literal iniciando por um ID (CT/RNF/USA), lendo `tag` do 2º argumento (string ou array literal), e, dentro do corpo, a chamada `jornada('<ID>', { … }, …)`: `passos` = nomes das propriedades **literais** do 2º argumento, normalizados. `passos: null` quando o teste não usa `jornada` (permitido para `@rnf`/`@usabilidade`/`@sistemico`).

- [ ] **Step 1: Write the failing tests**

```ts
const SRC = `
test('CT-RES-003 publicar', { tag: ['@e2e', '@regressao'] }, async ({ page }) => {
  await jornada('CT-RES-003', {
    'Dado que estou logado': async () => {},
    'abro a lista de recursos': async () => {},
  }, { page })
})
test('RNF-SEG-001 headers', { tag: '@rnf' }, async () => {})
test('sem id', async () => {})
`
it('extrai id, tags e passos normalizados', () => {
  expect(scanTestes(SRC, 'a.spec.ts').refs).toEqual([
    expect.objectContaining({ id: 'CT-RES-003', tags: ['@e2e', '@regressao'], passos: ['que estou logado', 'abro a lista de recursos'] }),
    expect.objectContaining({ id: 'RNF-SEG-001', tags: ['@rnf'], passos: null }),
  ])
})
it.each(["[`x${y}`]: f", '[k]: f', '...outros'])('chave não literal (%s) → erro "chave de passo não literal"', …)
it('jornada com ID diferente do título → erro')
it('dois testes com o mesmo ID no arquivo → ambos aparecem (duplicidade é do check)')
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/e2eTestes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `scanTestes` (`typescript` já é devDependency da raiz).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(e2e): varredura estática de testes e passos da jornada`

---

### Task 3: `check-cenarios` e relatório de rastreabilidade

**Files:**

- Create: `scripts/e2e/config.mjs`, `scripts/check-cenarios.mjs`, `tests/e2e/cenarios.config.json`
- Modify: `package.json` (script `"check:cenarios": "node scripts/check-cenarios.mjs"`), `.github/workflows/pr-gate.yml` (passo após o atual)
- Test: `tests/unit/checkCenarios.test.ts`

**Interfaces:**

- Consumes: Tasks 1–2; `parseSpecLine` de `scripts/pr-gate.mjs`.
- Produces:
  - `cenarios.config.json`: `{ "specs": string[] (globs), "testes": string[] (globs), "paginas": string[] (globs de page.tsx), "appDir": string, "ajuda": string, "rnf": string }`. No template: specs `["docs/superpowers/specs/*.md", "examples/walking-skeleton/docs/specs/*.md"]`, testes `["tests/e2e/**/*.spec.ts", "examples/walking-skeleton/tests/e2e/**/*.spec.ts"]`, paginas `["examples/walking-skeleton/src/app/**/page.tsx"]`, appDir `examples/walking-skeleton/src/app`, ajuda `examples/walking-skeleton/docs/ajuda`, rnf `docs/rnf.md`.
  - `loadIndice(root: string): { config, cenarios: Map<string, Cenario>, rnf, erros }` (em `config.mjs`; usado também por `tests/e2e/support`).
  - `rotaDaPagina(path: string, appDir: string): string` — remove `(grupo)`, mantém `[id]`, `page.tsx` → rota; raiz → `/`.
  - `checkCenarios({ indice, refs, ajudaFiles: Map<string, AjudaDoc>, paginas: string[], specDoPr: string | null, paginasNovas: string[] }): { erros: string[], avisos: string[], relatorio: string }`
  - `AjudaDoc = { id: string, titulo: string, perfil: string, passos: { texto: string, imagem: string }[] }` (JSON em `<ajuda>/<CTX>/<ID>.json`; definido aqui, escrito na Task 8).

Regras (spec §8.1), **erro** quando o item pertence à spec do PR (ou a uma página nova do PR), **aviso** caso contrário:

- cenário com `@regressao` sem `TesteRef` de mesmo ID; ref sem cenário/RNF/USA existente (órfão — sempre erro); ref de cenário aposentado;
- `passos` da ref ≠ passos normalizados do cenário (mostrar faltando/sobrando);
- cenário `@doc` sem `AjudaDoc` ou com passos diferentes;
- ID duplicado entre specs (sempre erro);
- RNF declarado na spec do PR (`RNF-…` na seção "Requisitos não funcionais") sem teste;
- página (via `rotaDaPagina`) fora de `telas` e `exclusoes`;
- tag do teste diferente do `tipo`/destinos do cenário.
  `relatorio`: markdown `| Cenário | Critério | Teste | Doc | Situação |`.
  CLI: lê `GITHUB_EVENT_PATH` (corpo do PR → `parseSpecLine`; `n/a` → `specDoPr = null`), `paginasNovas` = `git diff --name-only --diff-filter=A origin/$GITHUB_BASE_REF...HEAD` filtrado pelos globs de páginas; escreve `relatorio` em `$GITHUB_STEP_SUMMARY` e em `.e2e/rastreabilidade.md`; exit 1 se houver erro. Sem `GITHUB_EVENT_PATH` (local), usa `--spec <path>` opcional.

- [ ] **Step 1: Write the failing tests** — um `it` por regra acima, em erro e em aviso, mais:

```ts
it.each([
  ['src/app/page.tsx', '/'],
  ['src/app/(painel)/recursos/page.tsx', '/recursos'],
  ['src/app/recursos/[id]/page.tsx', '/recursos/[id]'],
])('rotaDaPagina(%s) = %s', (p, r) => expect(rotaDaPagina(p, 'src/app')).toBe(r))
it('spec do PR sem nenhum problema → sem erros e relatório com uma linha por cenário')
it('Spec: n/a → só checagens globais (órfão, duplicado) e o resto vira aviso')
it('spec malformada → erro com arquivo:linha, sem throw')
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/checkCenarios.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `config.mjs` e `check-cenarios.mjs`. Globs: o CI usa Node 20 (sem `fs.globSync`/`path.matchesGlob`), então exporte `globToRegExp(glob: string): RegExp` (só `**`, `*` e literais) e aplique sobre `git ls-files`; teste-o com `docs/superpowers/specs/*.md` (não casa subpasta) e `tests/e2e/**/*.spec.ts` (casa em qualquer profundidade).
- [ ] **Step 4: Add** o passo no `pr-gate.yml` (mesmo job `PR gate`, após "Validar título…"): `run: node scripts/check-cenarios.mjs` com `fetch-depth: 0` no checkout e `GITHUB_BASE_REF` disponível.
- [ ] **Step 5: Run** `npx vitest run tests/unit/checkCenarios.test.ts && npm run lint` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(e2e): check de cenários × testes no pr gate`

---

### Task 4: Infra Playwright na raiz e helpers de apoio

**Files:**

- Modify: `package.json` (devDeps `@playwright/test`, `@axe-core/playwright`; scripts `"test:e2e": "playwright test"`, `"docs:gerar": "E2E_DOCS=1 playwright test --grep @doc --project=desktop"`), `.gitignore` (`.e2e/`, `playwright/.auth/`)
- Create: `playwright.config.ts`, `tests/e2e/auth.setup.ts`, `tests/e2e/support/{index,jornada,dado,rnf,auth,axe,env}.ts`, `tests/e2e/tsconfig.json`
- Test: `tests/e2e/support/jornada.selftest.spec.ts` (Playwright, sem app), `tests/unit/e2eEnv.test.ts`

**Interfaces:**

- Consumes: `loadIndice` (Task 3).
- Produces (exportados por `tests/e2e/support/index.ts`):
  - `jornada(id: string, passos: Record<string, () => Promise<void>>, opts?: { page?: Page }): Promise<void>` — busca o cenário no índice, falha se o ID não existir ou se as chaves não baterem com os passos (mesma comparação do check), e executa um `test.step(\`${palavra} ${texto}\`)`por passo, em ordem. Gancho`onPasso(ctx)`registrável (usado na Task 8 e no Plano 2):`registrarGanchoDePasso(fn: (ctx: { id, indice, texto, page? }) => Promise<void>)`.
  - `dado(texto: string): string` — `texto` se `E2E_RUN_PREFIX` vazio, senão `` `${texto} · ${prefixo}` ``.
  - `rnf(id: string): Requisito`, `rnfMs(id: string): number`, `telas(): { rota, nome }[]`.
  - `checarA11y(page: Page): Promise<void>` (axe com as tags das Global Constraints; falha em `serious`/`critical`, anexa `moderate` ao relatório).
  - `perfis = { usuario: 'playwright/.auth/usuario.json', interno: 'playwright/.auth/interno.json' }`.
  - `loginDev(page: Page, perfil: 'usuario'|'interno')` (visita `/dev-login?perfil=…&next=/`), `loginAuth0(page: Page, cred: { email, senha })` (Universal Login: `input[name=username]`, `input[name=password]`, `button[type=submit][name=action]`).
  - `e2eEnv(env = process.env): { baseUrl: string | null, auth: 'dev' | 'auth0', bypass: string | null, faultsSecret: string | null, runPrefix: string, pat: { usuario: string | null } }`.
- `playwright.config.ts` (template): `testDir: '.'`, `testMatch` = os globs de `testes` do `cenarios.config.json`; projetos das Global Constraints; `setup` com `testMatch: /auth\.setup\.ts/`; `desktop`/`mobile` com `storageState: perfis.usuario` e `dependencies: ['setup']`, `grep` por `@e2e|@usabilidade`; `sistemico` sem navegador, `grep` por `@sistemico|@rnf`; `use.baseURL = e2eEnv().baseUrl ?? 'http://localhost:3100'`; `extraHTTPHeaders` com `x-vercel-protection-bypass` + `x-vercel-set-bypass-cookie: 'true'` quando `bypass`; `webServer` **só sem** `baseUrl`: `npm --prefix examples/walking-skeleton run build && npm --prefix examples/walking-skeleton run start -- -p 3100`, `env: { APP_ENV: 'e2e', RESOURCES_ENABLED: 'on', E2E_SESSION_SECRET, E2E_FAULTS_SECRET, DEV_PERSONAL_TOKEN }` com valores fixos de teste gerados no config, `reuseExistingServer: !process.env.CI`, `timeout: 180_000`.

- [ ] **Step 1: Write the failing tests** — `e2eEnv` (Vitest): defaults, `E2E_AUTH=auth0`, `E2E_BASE_URL` vazio → `null`. `jornada.selftest.spec.ts` (Playwright puro, com um índice falso via `E2E_CENARIOS_CONFIG` apontando para fixture em `tests/e2e/support/__fixtures__/`): executa os passos na ordem; ID inexistente → erro "cenário CT-XXX-999 não encontrado"; chave sobrando → erro listando a chave.
- [ ] **Step 2: Run** `npm i -D @playwright/test @axe-core/playwright && npx playwright install chromium && npx playwright test tests/e2e/support --project=sistemico` — Expected: FAIL.
- [ ] **Step 3: Implement** os helpers e o config; `tests/e2e/tsconfig.json` estende o da raiz e inclui `tests/e2e/**` e `examples/walking-skeleton/tests/e2e/**`; `type-check` da raiz passa a ser `tsc --noEmit && tsc --noEmit -p tests/e2e`. Excluir `tests/e2e` do `tsconfig.json`/`vitest.config.ts` do skeleton.
- [ ] **Step 4: Run** o passo 2 de novo + `npm run type-check && npx vitest run tests/unit/e2eEnv.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(e2e): playwright na raiz com jornada, perfis e axe`

---

### Task 5: Skeleton — hardening, sessão `e2e`, timeouts e injeção de lentidão

**Files (todos em `examples/walking-skeleton/`):**

- Create: `src/shared/auth/E2eCookieAuthProvider.ts`, `src/shared/http/withRouteTimeout.ts`, `src/shared/http/e2eFaults.ts`, `src/shared/http/fetchWithTimeout.ts`, `src/middleware.ts`, `src/app/dev-login/page.tsx`, `src/app/api/dev-login/route.ts`, `src/app/api/logout/route.ts`
- Modify: `src/shared/appEnv.ts` (`isE2eLocalEnvironment`), `src/shared/errors.ts` (`TimeoutError` → `code 'TIMEOUT'`, 504, técnico), `src/composition.ts` (provider por ambiente; handlers embrulhados), `src/modules/resources/interfaces/http/handlers.ts` (ou a composição) para `withRouteTimeout`, `src/ui/hooks/useResources.ts` (usa `fetchWithTimeout`), `next.config.mjs` (headers)
- Test: `tests/unit/{appEnv,E2eCookieAuthProvider,withRouteTimeout,e2eFaults,fetchWithTimeout}.test.ts`

**Interfaces:**

- Produces:
  - `isE2eLocalEnvironment(env = process.env): boolean` = `env.APP_ENV === 'e2e' && !env.VERCEL`.
  - `class E2eCookieAuthProvider implements IAuthProvider` — `constructor(opts: { secret: string, clock: Clock, idleMs: number, maxMs: number })`; `issue(perfil: 'usuario'|'interno'): { cookie: string, sessionId: string }`; `revoke(sessionId: string): void`; `getUser(req)` lê o cookie `e2e_session` (HMAC-SHA256 de `sessionId.perfil.issuedAt.lastSeen`), devolve `null` fora de `isE2eLocalEnvironment()`, se revogado, se `now - lastSeen > idleMs` ou `now - issuedAt > maxMs`. Perfis → `AuthUser`: `usuario` = `{ id: 'dev-user', tenantId: 'dev-tenant', scopes: ['resources:read','resources:write','ajuda:read'] }`, `interno` = mesmo + `'ajuda:interno'`. Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<idleMs/1000>`.
  - `withRouteTimeout(handler: (req: Request) => Promise<Response>, ms: number, context: string): (req: Request) => Promise<Response>` — corrida com timeout → `handleApiError(new TimeoutError(), context)` (504 `{ error: 'A operação demorou demais. Tente novamente.', code: 'TIMEOUT' }`); aplica `e2eDelayMs(req)` antes do handler.
  - `e2eDelayMs(req: Request, env = process.env): number` — 0 salvo as condições das Global Constraints; máximo 60 000.
  - `fetchWithTimeout(input, init?, ms = 15_000): Promise<Response>` — `AbortController` + `setTimeout` (controlável por `page.clock`); rejeita com `TimeoutError`.
  - `middleware.ts`: em rotas de tela (não `/api`, não `/dev-login`, não estáticos), sem sessão válida (cookie ausente/inválido — verificação HMAC leve, mesma função pura exportada por `E2eCookieAuthProvider.verify`) → redirect `302` para `/dev-login?next=<path+query>` **só no modo e2e**; nos outros modos, `NextResponse.next()`.
  - `next.config.mjs` `headers()` para `/:path*`: `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
  - Composição: com `isE2eLocalEnvironment()` usa `E2eCookieAuthProvider` (idle/max lidos de env `E2E_SESSION_IDLE_MS`/`E2E_SESSION_MAX_MS`, padrão 8 h / 7 d) e emite PAT do `dev-user` com `DEV_PERSONAL_TOKEN`; senão mantém `StubAuthProvider` (os testes de integração existentes não mudam). Timeout das rotas: `API_TIMEOUT_MS` padrão `10_000`.

- [ ] **Step 1: Write the failing tests**

```ts
// E2eCookieAuthProvider.test.ts
it('cookie emitido autentica o perfil usuario sem ajuda:interno')
it('perfil interno ganha ajuda:interno')
it('VERCEL=1 com APP_ENV=e2e → null (fail-closed)')
it('APP_ENV=development → null')
it('inativo além de idleMs → null'); it('além de maxMs mesmo ativo → null')
it('assinatura adulterada → null'); it('revogado → null')
it('Set-Cookie tem HttpOnly, Secure, SameSite=Lax e Max-Age=28800')
// e2eFaults.test.ts
it.each([
  [{ APP_ENV: 'production', E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), '500', 0],
  [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, undefined, '500', 0],
  [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 'curto' }, 'curto', '500', 0],
  [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), '500', 500],
  [{ APP_ENV: 'uat', E2E_FAULTS_SECRET: 's'.repeat(16) }, 's'.repeat(16), '999999', 60000],
])('e2eDelayMs(%o) = %i', …)
// withRouteTimeout.test.ts (fake timers)
it('handler mais lento que ms → 504 TIMEOUT com mensagem genérica')
it('handler rápido → resposta original intacta')
it('com APP_ENV=production e header de atraso → sem atraso, mesma resposta')
// fetchWithTimeout.test.ts (fake timers)
it('rejeita com TimeoutError após 15 000 ms'); it('resolve antes do prazo')
```

- [ ] **Step 2: Run** `cd examples/walking-skeleton && npx vitest run tests/unit` — Expected: FAIL nos novos.
- [ ] **Step 3: Implement** conforme Interfaces; `useResources` passa a mostrar `'A operação demorou demais. Tente novamente.'` em `TimeoutError` (técnico) e o `ResourcesView` diferencia erro funcional (`role="status"`, classe/tom de aviso) de técnico (`role="alert"`) — afirmado nos E2E pela role, não pela cor.
- [ ] **Step 4: Run** `cd examples/walking-skeleton && npm run lint && npm run type-check && npm test && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(skeleton): sessão e2e, hardening, timeouts e injeção de lentidão`

---

### Task 6: Baseline de RNF e usabilidade (`docs/rnf.md` + suítes)

**Files:**

- Create: `docs/rnf.md`, `tests/e2e/baseline/{seguranca,timeout,sessao,performance,usabilidade}.spec.ts`
- Modify: `tests/e2e/auth.setup.ts` (dev: `loginDev` para os dois perfis; auth0: `loginAuth0` com `E2E_USUARIO_EMAIL/SENHA`, `E2E_INTERNO_EMAIL/SENHA`)

**Interfaces:**

- Consumes: Task 4 helpers; Task 5 comportamento do skeleton.
- `docs/rnf.md`: as 13 linhas da spec §5.2 (RNF-SEG-005 com texto "429 no REST ou `RATE_LIMITED` no MCP (ADR-010)"), mais `USA-001`…`USA-005` (spec §6, um por item), `## Telas` com `/` e `/resources` (e `/ajuda`, adicionada na Task 8), `## Exclusões` com `/dev-login`. Configuração de sessão/rotas para os testes genéricos fica numa seção `## Parâmetros dos testes` (tabela `| Chave | Valor |`): `cookieDeSessao = e2e_session`, `rotaDeLogin = /dev-login`, `rotaDeLogout = /api/logout`, `rotaProtegida = /api/resources`, `rotasPublicas = /, /.well-known/oauth-protected-resource`. Estender `parseRnf` (Task 1) com `parametros: Record<string, string>` e teste.

Testes (título começa pelo ID; tag `@rnf`/`@usabilidade` + `@regressao`):

- `RNF-SEG-001`: GET `/` e cada tela → os 5 headers presentes (`frame-ancestors` no CSP **ou** `X-Frame-Options`).
- `RNF-SEG-002`: após login, cookie `cookieDeSessao` com `httpOnly`, `secure`, `sameSite` ∈ {Lax, Strict}.
- `RNF-SEG-003`: `rotaProtegida` sem cookie → 401; com PAT sem escopo (`personalTokens` não acessível de fora → usar PAT de leitura só no MCP: `tools/call create_resource` com token de leitura → `isError` FORBIDDEN).
- `RNF-SEG-004`: forçar erro técnico via `x-e2e-delay-ms` > `RNF-TMO-001` → corpo só `{ error, code }`, sem `at `, `Error:` ou `/src/`.
- `RNF-SEG-005`: 61 `tools/call list_resources` com o PAT → a última com `RATE_LIMITED`.
- `RNF-SEG-006`: POST `/api/mcp` sem token → 401 com `www-authenticate` contendo `resource_metadata`.
- `RNF-TMO-001`: atraso `rnfMs('RNF-TMO-001') + 1000` → 504 `TIMEOUT` em < `rnfMs + 3000`.
- `RNF-TMO-002` (desktop): `page.clock.install()`, `page.route('**/api/resources', () => {/* nunca responde */})`, abrir `/resources`, `page.clock.fastForward(rnfMs('RNF-TMO-002'))` → `getByRole('alert')` com "Tente novamente".
- `RNF-SES-001`: expiração do cookie − agora ≤ inatividade + 60 s.
- `RNF-SES-002`: contexto com cookie inválido → `/resources` redireciona para `rotaDeLogin?next=/resources`; após logar, volta para `/resources`.
- `RNF-SES-003`: guarda o cookie, chama `rotaDeLogout`, reinjeta o cookie antigo → `rotaProtegida` 401.
- `RNF-PRF-001`: GET `rotaProtegida` com sessão < `rnfMs('RNF-PRF-001')` (média de 3, descarta a 1ª).
- `RNF-PRF-002` (mobile): LCP via `PerformanceObserver` em cada tela < `rnfMs('RNF-PRF-002')`.
- `USA-001`…`USA-005`: para cada `telas()`: axe (`checarA11y`); `scrollWidth <= clientWidth`; no mobile, todo `button, a, input` visível com caixa ≥ 44×44 (exceto inline em texto); Tab percorre os focáveis e cada um tem outline/box-shadow de foco ≠ none; botões sem texto têm `aria-label` (coberto pelo axe `button-name`, afirmado explicitamente).

Ajustes no skeleton que os testes exigirem (ex.: altura mínima de botão/input de 44 px no mobile, foco visível) entram nesta task, com tokens semânticos (BEST_PRACTICES).

- [ ] **Step 1: Write** `docs/rnf.md`, o teste de `parametros` no `e2eRnf.test.ts` e as cinco suítes.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/baseline` — Expected: FAIL nos itens que o skeleton ainda não cumpre (anotar quais).
- [ ] **Step 3: Implement** os ajustes no skeleton e no `parseRnf`.
- [ ] **Step 4: Run** `npx playwright test tests/e2e/baseline && npm run check:cenarios` — Expected: PASS (3 projetos), check sem erros.
- [ ] **Step 5: Commit** `feat(e2e): baseline de rnf e usabilidade com docs/rnf.md`

---

### Task 7: Spec template e cenários de exemplo do módulo `resources`

**Files:**

- Modify: `docs/superpowers/specs/_TEMPLATE.md` (critérios `CA-n`; "7. Requisitos não funcionais"; "8. Cenários de teste" com o bloco de exemplo da spec §4.1 e as regras de tag/ID/cobertura mínima §4.3; renumerar 9–10)
- Create: `examples/walking-skeleton/docs/specs/resources.md`, `examples/walking-skeleton/tests/e2e/resources/{listar,criar}.spec.ts`, `examples/walking-skeleton/tests/e2e/resources/api.spec.ts`
- Test: os próprios cenários + `npm run check:cenarios -- --spec examples/walking-skeleton/docs/specs/resources.md`

Cenários do exemplo (`<CTX>` = `RES`):

- `CT-RES-001` `@e2e` `@doc` `@demo` — criar recurso com título válido e vê-lo na lista (CA-1).
- `CT-RES-002` `@e2e` — título com menos de 3 caracteres: botão "Criar" desabilitado; via API, `VALIDATION_ERROR` aparece como aviso (`role="status"`) (CA-2).
- `CT-RES-003` `@e2e` `@usabilidade` — criar recurso só com teclado (CA-1).
- `CT-RES-004` `@sistemico` — GET `/api/resources` lista só os do ator; POST sem sessão → 401 (CA-3).
- `CT-RES-005` `@sistemico` — MCP `tools/list` sem `create_resource` com a flag de escrita desligada (CA-4).
- `CT-RES-006` `@e2e` `@doc` — `Perfil: time interno`; ver a lista de recursos como time interno (prova a separação na `/ajuda`, Task 8).

Dados com `dado('Plano de estudos')`; seletores `getByRole`/`getByLabel`.

- [ ] **Step 1: Write** a spec de exemplo e os três `.spec.ts` usando `jornada`.
- [ ] **Step 2: Run** `npx playwright test examples/walking-skeleton/tests/e2e && npm run check:cenarios -- --spec examples/walking-skeleton/docs/specs/resources.md` — Expected: testes PASS; o check acusa só `@doc` sem página (CT-RES-001, CT-RES-006) — resolvido na Task 8.
- [ ] **Step 3: Update** `_TEMPLATE.md`.
- [ ] **Step 4: Commit** `feat(e2e): cenários de exemplo do skeleton e template de spec com cenários`

---

### Task 8: `docs:gerar` e a rota `/ajuda`

**Files:**

- Create: `tests/e2e/support/docs.ts` (gancho de passo), `examples/walking-skeleton/src/modules/ajuda/{application/AjudaService.ts,application/schemas.ts,application/dto.ts,infrastructure/FsAjudaSource.ts,interfaces/http/handlers.ts,index.ts}`, `examples/walking-skeleton/src/app/ajuda/page.tsx`, `examples/walking-skeleton/src/app/ajuda/[id]/page.tsx`, `examples/walking-skeleton/src/app/api/ajuda/[id]/imagem/[n]/route.ts`, `examples/walking-skeleton/src/ui/components/AjudaPassoAPasso.tsx`
- Modify: `tests/e2e/support/index.ts` (registra o gancho quando `E2E_DOCS=1`), `examples/walking-skeleton/src/composition.ts`, `examples/walking-skeleton/next.config.mjs` (`outputFileTracingIncludes: { '/api/ajuda/**': ['./docs/ajuda/**'], '/ajuda/**': ['./docs/ajuda/**'] }`), `docs/rnf.md` (tela `/ajuda`)
- Test: `examples/walking-skeleton/tests/unit/AjudaService.test.ts`, `tests/unit/e2eDocs.test.ts`, cenário `CT-AJU-001` em `examples/walking-skeleton/docs/specs/ajuda.md` + `tests/e2e/ajuda/ajuda.spec.ts`

**Interfaces:**

- Consumes: `registrarGanchoDePasso`, `AjudaDoc` (Task 3), `loadIndice`.
- Produces:
  - Gancho de docs: em cada passo com `page`, após o passo, `page.screenshot({ path: <ajuda>/<CTX>/<ID>/<NN>.png, mask: [page.locator('[data-sensivel]')] })`; ao fim do teste escreve `<ajuda>/<CTX>/<ID>.json` (`AjudaDoc`, `imagem` = `NN.png`). Antes de cada screenshot falha se `page.content()` contiver qualquer valor de `E2E_*SECRET*`, `E2E_PAT_*`, `DEV_PERSONAL_TOKEN` ou senha de perfil. Função pura testável: `contemSegredo(texto: string, env): string | null`.
  - `IAjudaSource { list(): Promise<AjudaDoc[]>; get(id): Promise<AjudaDoc | null>; imagem(id, n): Promise<Uint8Array | null> }`; `FsAjudaSource(dir)`.
  - `AjudaService(source)`: `list(actor)` — `requireScope(actor, 'ajuda:read')`, filtra `time interno` sem `ajuda:interno`; `get(actor, { id })` e `imagem(actor, { id, n })` — mesmo guard; doc interno sem escopo → `NotFoundError` (não revela existência).
  - Página `/ajuda`: lista por contexto; `/ajuda/[id]`: passo atual (screenshot + legenda), botões "Anterior"/"Próximo" com `aria-label` e setas do teclado; imagens só via `/api/ajuda/[id]/imagem/[n]` (rota com o mesmo guard). Sem `docs/ajuda` → página vazia amigável.

- [ ] **Step 1: Write the failing tests** — `AjudaService`: sem `ajuda:read` → Forbidden; usuário não vê doc interno na lista nem por `get` (NotFound); interno vê ambos; imagem segue o mesmo guard. `contemSegredo`: acha PAT no HTML; ignora segredo vazio/curto (< 8). `CT-AJU-001` `@e2e` `@usabilidade`: usuário abre `/ajuda`, vê CT-RES-001 e não vê CT-RES-006, navega Próximo/Anterior só com teclado.
- [ ] **Step 2: Run** `cd examples/walking-skeleton && npx vitest run tests/unit/AjudaService.test.ts` e `npx vitest run tests/unit/e2eDocs.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; rodar `npm run docs:gerar` (gera `examples/walking-skeleton/docs/ajuda/RES/…`) e commitar os arquivos gerados.
- [ ] **Step 4: Run** `npx playwright test && npm run check:cenarios -- --spec examples/walking-skeleton/docs/specs/resources.md` — Expected: tudo PASS, check sem erros. `cd examples/walking-skeleton && npm test && npm run build` — PASS.
- [ ] **Step 5: Commit** `feat(ajuda): documentação interativa gerada dos cenários @doc`

---

### Task 9: Workflow `Regressão (UAT)` e espera do preview

**Files:**

- Create: `.github/workflows/e2e-regressao.yml`, `scripts/e2e/wait-preview.mjs`
- Modify: `hooks/protect-main/config.json` (`requiredChecks` += `"Regressão (UAT)"`)
- Test: `tests/unit/e2eWaitPreview.test.ts`; ajustar `tests/unit/mainGuard.test.ts`/`protectMain*.test.ts` se fixarem a lista atual

**Interfaces:**

- Produces: `waitPreview({ api, sha, timeoutMs = 900_000, intervalMs = 15_000, now, sleep }): Promise<{ url: string }>` — lista `GET /repos/{repo}/deployments?sha=<sha>`, filtra `environment` que começa por `Preview`, pega o mais recente, lê `/statuses`; `success` → `environment_url ?? target_url`; `failure`/`error` → lança "Deploy de preview falhou"; sem deploy até o timeout → lança "Nenhum deploy de preview para <sha> em 15 min". Usa o cliente de `scripts/github-api.mjs`. CLI escreve `url=<…>` em `$GITHUB_OUTPUT`.
- Workflow `name: Regressão (UAT)`, job `name: Regressão (UAT)`; `on: pull_request: [opened, synchronize, reopened]`, `branches: [main]`; `permissions: contents: read, deployments: read, pull-requests: write`; `concurrency` por PR com `cancel-in-progress: true`. Passos: checkout do head; setup-node 20; `npm ci`; `npm ci` em `examples/walking-skeleton` se `hashFiles('examples/walking-skeleton/package.json') != ''`; `npx playwright install --with-deps chromium`; se `vars.E2E_TARGET == 'preview'` → `node scripts/e2e/wait-preview.mjs` e exporta `E2E_BASE_URL`; `npm run test:e2e -- --grep @regressao` com `CI=1`, `E2E_RUN_PREFIX=${{ github.run_id }}` (só no preview), segredos `VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_FAULTS_SECRET`, `E2E_PAT_USUARIO`, `E2E_USUARIO_EMAIL/SENHA`, `E2E_INTERNO_EMAIL/SENHA`, `E2E_AUTH=auth0` no preview; `npm run check:cenarios` (sem falhar o job — o PR gate já falha; aqui é para o relatório); `actions/upload-artifact` de `playwright-report/` e `.e2e/` com `if: always()`; comentário no PR (`gh pr comment --edit-last || gh pr comment`) com status e link do run.

- [ ] **Step 1: Write the failing tests** para `waitPreview` com `api` falso e relógio falso: success → url; failure → erro; nunca aparece → erro após 900 000 ms simulados (sem esperar de verdade); ignora environment `Production`; usa o deploy mais recente quando há dois.
- [ ] **Step 2: Run** `npx vitest run tests/unit/e2eWaitPreview.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** script, workflow e `requiredChecks`.
- [ ] **Step 4: Run** `npm test && npm run lint` — Expected: PASS (inclusive testes do protect-main/main-guard).
- [ ] **Step 5: Commit** `ci(e2e): check obrigatório regressão (uat) contra preview ou app local`

---

### Task 10: ADR-016, guias, template de PR, skills, runbooks e manifest

**Files:**

- Create: `docs/adr/template/016-testes-e2e-nascidos-da-spec.md`, `docs/guides/e2e-guide.md`, `docs/runbooks/e2e-uat-configurar.md`
- Modify: `docs/guides/testing-guide.md` (seção "E2E com Playwright (opcional)" → aponta para o guia novo; pirâmide sem "opcional" para features com UI), `docs/runbooks/deploy-uat.md` (passo novo após o 7: `[R0] gh pr checks <n> --watch` até `Regressão (UAT)` `pass`; vermelho → corrigir, nunca liberar), `docs/runbooks/README.md` (catálogo), `.github/pull_request_template.md` (seção `## Cenários × testes` após "Spec × código": "Cole o relatório de rastreabilidade do job `PR gate`" + checkbox `- [ ] npm run docs:gerar rodado e docs/ajuda commitado (se houver @doc)`), `.claude/skills/mvp-development/SKILL.md` e `.claude/skills/ddd-service-development/SKILL.md` (passos "escrever o teste Playwright de cada cenário antes da tela/rota" e "`npm run docs:gerar` antes do PR"), `CLAUDE.md` (regra 1: cenários na spec revisados pela QA; checklist: `npm run test:e2e`, `npm run check:cenarios`), `SKILLS.md`, `README.md` (comandos), `template-sync.manifest.json` (`managed` += `tests/e2e/support/**`, `tests/e2e/baseline/**`, cada `tests/unit/*.test.ts` novo; `scripts/**`, `.github/**`, `docs/**` já cobertos), `docs/adr/README` se existir índice
- Test: `npm run check:runbooks`, `npx vitest run tests/unit/docsLinks.test.ts tests/unit/templateSyncManifest.test.ts`

ADR-016 resume spec §§4–10 (Contexto / Decisão / Consequências / Alternativas: Cucumber/playwright-bdd, E2E opcional, regressão só no merge). O guia cobre: formato do cenário, `jornada`/`dado`, tags, `docs/rnf.md`, rodar local (`npm run test:e2e`, `--ui`), ler o relatório e a rastreabilidade, `docs:gerar`, modo `e2e` local × preview. Runbook `e2e-uat-configurar.md` no formato de `docs/runbooks/_TEMPLATE.md`: [R2] criar usuários de teste no Auth0 de UAT (dois perfis); [R2] emitir PAT do usuário; [R2] criar segredos do GitHub (`VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_FAULTS_SECRET`, `E2E_PAT_USUARIO`, `E2E_USUARIO_EMAIL/SENHA`, `E2E_INTERNO_EMAIL/SENHA`); [R2] env `E2E_FAULTS_SECRET` no Preview da Vercel; [R1] variável `E2E_TARGET=preview`; rollback = `E2E_TARGET` removida (volta ao alvo local).

- [ ] **Step 1: Write** os documentos e as edições.
- [ ] **Step 2: Run** `npm run check:runbooks && npx vitest run && npm run lint && npm run type-check` — Expected: PASS.
- [ ] **Step 3: Run** a verificação final completa: `npm test && npx playwright test && npm run check:cenarios -- --spec examples/walking-skeleton/docs/specs/resources.md && (cd examples/walking-skeleton && npm run lint && npm run type-check && npm test && npm run build)` — Expected: tudo PASS.
- [ ] **Step 4: Commit** `docs(e2e): adr-016, guia de e2e, runbook e skills`

---

## Cobertura da spec (Plano 1 × Plano 2)

| Spec                                            | Onde                                     |
| ----------------------------------------------- | ---------------------------------------- |
| §4 cenários, IDs, tags, cobertura               | Tasks 1, 2, 3, 7                         |
| §5 RNF baseline e desvios                       | Tasks 1, 3, 5, 6                         |
| §6 usabilidade                                  | Tasks 6, 7, 8                            |
| §7 Playwright, jornada, dados, perfis, flaky    | Tasks 4, 6, 9                            |
| §8.1 check de cenários                          | Task 3                                   |
| §8.2 Regressão (UAT)                            | Task 9, runbook na 10                    |
| §9.1 documentação interativa                    | Task 8                                   |
| §10 ADR-016, guia, template, skills, manifest   | Tasks 7, 10                              |
| §8.3, §9.2, ADR-017, `bunny-habilitar.md`, CA-6 | **Plano 2** (demos/treinamento no Bunny) |
