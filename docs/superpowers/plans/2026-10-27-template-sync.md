# Template sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skill `template-sync` + motor determinístico que levam as Releases do template a projetos derivados (e melhorias de volta) via PR, com aviso semanal e visão de status.

**Architecture:** Motor em Node puro (`scripts/template-sync.mjs` + módulos em `scripts/template-sync/`), sem dependências novas, que fala com git via `execFileSync` e devolve JSON; a skill (`.claude/skills/template-sync/SKILL.md`) faz o julgamento (juntar conflitos, perguntar, generalizar, abrir PR). Um workflow semanal por projeto (`template-sync-check.yml` + `scripts/template-sync-check.mjs`) mantém uma issue única de atraso. Os ADRs do template passam para `docs/adr/template/`.

**Tech Stack:** Node 20 ESM (`.mjs` com JSDoc, como `scripts/release.mjs`), git CLI, GitHub REST via `scripts/github-api.mjs`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-template-sync-design.md`

## Global Constraints

- Sem dependências npm novas; glob próprio (Node 20 não tem `path.matchesGlob` estável).
- Scripts seguem o padrão de `scripts/release.mjs`: comentário de cabeçalho citando a spec, funções puras exportadas, guarda `isMain` com `realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)`.
- Mensagens ao humano em pt-BR; nomes de código em inglês.
- Nenhum arquivo versionado do template nomeia conta, owner, repo concreto ou projeto (exceto `docs/superpowers/`). Exemplos usam `<owner>`.
- Tudo termina em PR; o motor e a skill nunca rodam `gh pr merge`, nunca dão push na `main`, nunca marcam o UAT.
- Sem feature toggle (decisão do humano). Não exposto via MCP (é ferramenta de dev).
- Arquivo de controle: `.template-sync.json` = `{ template: string (URL https do repo), lastSync: { version: string | null, commit: string (sha 40), date: 'AAAA-MM-DD' }, projectOwned: string[] }`; `version` só é `null` com base anterior às Releases.
- Rótulos de issue: `template-sync` (aviso no projeto), `template-status` (relatório no template).
- Título da issue de aviso: `Template: N versões atrás (vX → vY)`; com `version: null`: `Template: N versões atrás (base anterior às Releases → vY)`.
- Título do PR de sync: `chore(template): sync vX → vY` (com base nula: `chore(template): adota o template vY`).
- Árvore suja no projeto → motor recusa com `Árvore suja no projeto: faça commit ou stash antes do sync.`
- `npm run lint`, `npm run type-check`, `npm test`, `npm run check:runbooks` verdes ao fim de cada task.

## Review Focus

1. Projeto cuja base é anterior ao manifesto e aos ADRs em `docs/adr/template/` (os 4 reais) → os ADRs velhos viram `move`, nunca `delete`/`ask` em massa (teste na Task 2).
2. ADR do **projeto** com o mesmo número de um ADR do template (ex.: `docs/adr/014-perfil.md` ≠ `014-release-management.md`) → nunca tocado, links para ele nunca reescritos (teste na Task 4).
3. Arquivo com acentos/espaços no caminho e arquivos binários → `git ls-files -z`/`ls-tree -z` e cópia por bytes, não por string (teste na Task 2/3).
4. Segundo `plan` logo após `apply` + `finish` + commit → todas as entradas `action: 'none'` (teste na Task 3).
5. `merge-file` sem conflito que gera JSON inválido em `package.json` → vira conflito `invalid-json`, arquivo não fica quebrado em silêncio (teste na Task 3).

---

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `template-sync.manifest.json` | `managed` / `ignore` (globs) — o que é do template |
| `scripts/template-sync/manifest.mjs` | carregar manifesto, glob → regex, `isManaged` |
| `scripts/template-sync/control.mjs` | ler/validar/escrever `.template-sync.json` |
| `scripts/template-sync/git.mjs` | wrappers git (árvores, blobs, renomes, merge-file, tags) |
| `scripts/template-sync/classify.mjs` | classificação pura da tabela §5.2 |
| `scripts/template-sync/apply.mjs` | aplicar o plano, validar JSON, notas de `examples/` |
| `scripts/template-sync/links.mjs` | reescrita de links de ADR |
| `scripts/template-sync/versions.mjs` | Release mais nova, versões atrás, proposta de base |
| `scripts/template-sync/inventory.mjs` | matéria-prima do `status`, checagem agnóstica |
| `scripts/template-sync.mjs` | CLI (subcomandos, JSON no stdout) |
| `scripts/template-sync-check.mjs` + `.github/workflows/template-sync-check.yml` | aviso semanal |
| `.claude/skills/template-sync/SKILL.md` | modos `sync`, `adotar`, `contribuir`, `status` |
| `docs/adr/template/*.md` | ADRs 001–015 do template |
| `tests/unit/templateSync*.test.ts`, `tests/unit/docsLinks.test.ts`, `tests/helpers/gitRepo.ts` | testes |

---

### Task 1: Manifesto e arquivo de controle

**Files:**
- Create: `template-sync.manifest.json`, `scripts/template-sync/manifest.mjs`, `scripts/template-sync/control.mjs`
- Test: `tests/unit/templateSyncManifest.test.ts`, `tests/unit/templateSyncControl.test.ts`

**Interfaces:**
- Produces:
  - `globToRegExp(glob: string): RegExp` — `**` casa qualquer coisa inclusive `/`; `*` casa sem `/`; `**/` no meio casa zero ou mais diretórios; demais caracteres literais.
  - `parseManifest(json: unknown): { managed: string[], ignore: string[] }` — lança `Error('Manifesto inválido: …')`.
  - `makeMatcher(...manifests: Manifest[]): (path: string) => boolean` — gerenciado = casa algum `managed` da união **e** nenhum `ignore` da união.
  - `MANIFEST_PATH = 'template-sync.manifest.json'`, `CONTROL_PATH = '.template-sync.json'`
  - `parseControl(json: unknown): Control`, `readControl(projectDir: string): Control | null` (ausente → `null`), `writeControl(projectDir: string, control: Control): void` (JSON com 2 espaços + `\n`).

- [ ] **Step 1: Escrever `template-sync.manifest.json`**

`managed`: `CLAUDE.md`, `ARCHITECTURE.md`, `BEST_PRACTICES.md`, `SKILLS.md`, `CONTRIBUTING.md`, `README.md`, `.claude/**`, `.githooks/**`, `hooks/**`, `scripts/**`, `.github/**`, `docs/adr/template/**`, `docs/adr/000-template.md`, `docs/runbooks/**`, `docs/guides/**`, `docs/superpowers/specs/_TEMPLATE.md`, `package.json`, `eslint.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.prettierrc`, `.gitignore`, `.env.local.example`, `tests/setup.ts`, cada arquivo atual de `tests/unit/` (lista explícita, um por linha) mais os criados neste plano, `tests/helpers/gitRepo.ts`, `template-sync.manifest.json`.
`ignore`: `examples/**`, `src/**`, `package-lock.json`, `.claude/settings.local.json`, `.env`, `.env.local`, `.env.*.local`, `tsconfig.tsbuildinfo`, `.superpowers/**`.

- [ ] **Step 2: Testes que falham**

```ts
it('glob: ** atravessa diretórios, * não', () => {
  expect(globToRegExp('.claude/**').test('.claude/skills/x/SKILL.md')).toBe(true)
  expect(globToRegExp('docs/*.md').test('docs/a/b.md')).toBe(false)
  expect(globToRegExp('.env.*.local').test('.env.prod.local')).toBe(true)
})
it('ignore vence managed e a união dos manifestos vale', () => {
  const m = makeMatcher({ managed: ['.claude/**'], ignore: ['.claude/settings.local.json'] }, { managed: ['docs/adr/template/**'], ignore: [] })
  expect(m('.claude/settings.json')).toBe(true)
  expect(m('.claude/settings.local.json')).toBe(false)
  expect(m('docs/adr/template/005-x.md')).toBe(true)
  expect(m('src/app/page.tsx')).toBe(false)
})
it('o manifesto do repo gerencia os testes do template mas não src/ nem examples/', () => {
  const m = makeMatcher(parseManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))))
  expect(m('tests/unit/release.test.ts')).toBe(true)
  expect(m('tests/unit/meuApp.test.ts')).toBe(false)
  expect(m('examples/walking-skeleton/package.json')).toBe(false)
})
it('todo arquivo de tests/unit do template está no manifesto', () => { /* readdirSync('tests/unit') ⊆ managed */ })
```

Controle: aceita o exemplo da spec §6; aceita `version: null`; rejeita `version` fora de `vX.Y.Z`, `commit` sem 40 hex, `date` fora de `AAAA-MM-DD`, `projectOwned` não-array, `template` não-https — cada um com mensagem `.template-sync.json inválido: <campo> …`. `readControl` em dir sem arquivo → `null`; `writeControl` + `readControl` ida e volta.

- [ ] **Step 3: Rodar e ver falhar** — `npx vitest run tests/unit/templateSyncManifest.test.ts tests/unit/templateSyncControl.test.ts` → FAIL (módulos inexistentes).
- [ ] **Step 4: Implementar** `manifest.mjs` e `control.mjs` com as assinaturas acima (validação manual, sem Zod — scripts de raiz não dependem de Zod).
- [ ] **Step 5: Rodar e ver passar**; `npm run lint && npm run type-check`.
- [ ] **Step 6: Commit** — `feat(template-sync): manifesto e arquivo de controle`

---

### Task 2: Git e classificação (`plan`)

**Files:**
- Create: `scripts/template-sync/git.mjs`, `scripts/template-sync/classify.mjs`, `scripts/template-sync.mjs` (só `plan` por enquanto), `tests/helpers/gitRepo.ts`
- Test: `tests/unit/templateSyncClassify.test.ts`, `tests/unit/templateSyncPlan.test.ts`

**Interfaces:**
- Consumes: `makeMatcher`, `parseManifest`, `MANIFEST_PATH`, `readControl` (Task 1).
- Produces:
  - `git.mjs`: `git(cwd: string, args: string[], opts?: { input?: Buffer }): Buffer`; `treeBlobs(repo: string, rev: string | null): Map<string, string>` (path → blob sha; `rev` null → mapa vazio; usa `ls-tree -r -z`); `projectBlobs(dir: string): Map<string, string>` (`ls-files -s -z`); `readBlob(repo: string, sha: string): Buffer`; `renames(repo: string, base: string, target: string): Map<string, string>` (novo → velho, `diff -M --name-status -z`, só `R*`); `isClean(dir: string): boolean`; `readManifestAt(repo: string, rev: string): Manifest | null`.
  - `classify.mjs`: `classifyEntry(e: { base: string|null, target: string|null, project: string|null, owned: boolean }): { case: Case, action: Action }` e `buildPlan(input: { base: Map, target: Map, project: Map, renames: Map<string,string>, isManaged: (p: string) => boolean, projectOwned: string[] }): PlanEntry[]`.
  - `Case = 'owned' | 'unchanged-template' | 'in-sync' | 'template-only' | 'both-changed' | 'add-add' | 'deleted-modified' | 'modified-deleted'`; `Action = 'none' | 'write' | 'delete' | 'move' | 'merge' | 'ask'`; `PlanEntry = { path, case, action, from?: string, base: string|null, target: string|null, project: string|null }`.
  - CLI: `node scripts/template-sync.mjs plan --template <dir> --project <dir> --target <tag>` → stdout `{ base: string|null, target: { tag, commit }, entries: PlanEntry[] }`; base vem de `readControl(project)?.lastSync.commit` ou `--base <sha|none>` (adoção).

- [ ] **Step 1: Helper `tests/helpers/gitRepo.ts`** — `makeRepo(): string` (mkdtemp + `git init -q -b main` + user/email locais), `commitFiles(dir, files: Record<string, string | null>, message): string` (null apaga; devolve sha), `tag(dir, name, sha)`. Usar `env` sem hooks globais como `protectMainRun.test.ts`.

- [ ] **Step 2: Testes de `classifyEntry` (puros), uma linha da §5.2 por teste**

```ts
expect(classifyEntry({ base: 'a', target: 'a', project: 'x', owned: false })).toEqual({ case: 'unchanged-template', action: 'none' })
expect(classifyEntry({ base: 'a', target: 'b', project: 'a', owned: false })).toEqual({ case: 'template-only', action: 'write' })
expect(classifyEntry({ base: 'a', target: null, project: 'a', owned: false })).toEqual({ case: 'template-only', action: 'delete' })
expect(classifyEntry({ base: null, target: 'b', project: null, owned: false })).toEqual({ case: 'template-only', action: 'write' })
expect(classifyEntry({ base: 'a', target: 'b', project: 'b', owned: false })).toEqual({ case: 'in-sync', action: 'none' })
expect(classifyEntry({ base: 'a', target: 'b', project: 'c', owned: false })).toEqual({ case: 'both-changed', action: 'merge' })
expect(classifyEntry({ base: null, target: 'b', project: 'c', owned: false })).toEqual({ case: 'add-add', action: 'ask' })
expect(classifyEntry({ base: 'a', target: null, project: 'c', owned: false })).toEqual({ case: 'deleted-modified', action: 'ask' })
expect(classifyEntry({ base: 'a', target: 'b', project: null, owned: false })).toEqual({ case: 'modified-deleted', action: 'ask' })
expect(classifyEntry({ base: 'a', target: 'b', project: 'a', owned: true })).toEqual({ case: 'owned', action: 'none' })
```

Ordem de avaliação: `owned` → `target === base` → `project === target` → `project === base` → demais.

- [ ] **Step 3: Testes de `buildPlan`**
  - renome `docs/adr/005-x.md` → `docs/adr/template/005-x.md` com projeto intocado → uma entrada em `docs/adr/template/005-x.md`, `action: 'move'`, `from: 'docs/adr/005-x.md'`; nenhuma entrada para o caminho velho.
  - mesmo renome com projeto alterado no caminho velho → `action: 'merge'`, `from` preenchido.
  - projeto com `docs/adr/014-perfil.md` próprio (fora de base/target) → nenhuma entrada.
  - arquivos fora de `isManaged` (ex.: `examples/a.json`, `src/x.ts`) → nenhuma entrada.
  - caminho em `projectOwned` → `case: 'owned'`.
  - entradas ordenadas por `path`.

- [ ] **Step 4: Teste de integração `plan`** (`templateSyncPlan.test.ts`): template com commit base (tag nenhuma) e commit alvo tag `v0.2.0` contendo manifesto; projeto clonado da base com um arquivo alterado e um caminho `docs/Ação inicial.md` (acentos/espaço) e um PNG binário mudado no template → rodar a CLI via `execFileSync('node', [...])`, parsear stdout, conferir casos esperados e `target.commit` = sha do tag.

- [ ] **Step 5: Rodar e ver falhar**; **Step 6: implementar** git/classify/CLI `plan` (renomes calculados só se base não for nula; manifesto da base via `readManifestAt`, ausente → só o do alvo); **Step 7: rodar e ver passar** + lint/type-check.
- [ ] **Step 8: Commit** — `feat(template-sync): classificação de três vias e comando plan`

---

### Task 3: Aplicar o plano (`apply`, `finish`)

**Files:**
- Create: `scripts/template-sync/apply.mjs`
- Modify: `scripts/template-sync.mjs` (subcomandos `apply`, `finish`)
- Test: `tests/unit/templateSyncApply.test.ts`

**Interfaces:**
- Consumes: `PlanEntry`, `readBlob`, `git`, `isClean` (Task 2); `readControl`/`writeControl` (Task 1).
- Produces:
  - `applyPlan(input: { templateDir: string, projectDir: string, plan: Plan }): ApplyReport` onde `ApplyReport = { applied: string[], merged: string[], conflicts: { path: string, kind: 'markers' | 'invalid-json' }[], asked: { path: string, case: Case }[], notes: string[] }`.
  - `mergeBlobs(templateDir, { base, target, project }: { base: string, target: string, project: Buffer }): { content: Buffer, conflicts: number }` — `git merge-file -p -L projeto -L base -L template` sobre arquivos temporários; exit code > 0 = nº de conflitos, < 0 lança.
  - `examplesNotes(projectDir: string, paths: string[]): string[]` — se o projeto não tem `examples/` e um arquivo escrito/juntado contém `examples/` ou `(example)`, nota `"<path>: cita o exemplo (examples/), que o projeto não tem — decida no PR se remove."`.
  - `finishSync({ projectDir, templateUrl?, tag, commit, date }): Control` — preserva `template` e `projectOwned` existentes; sem controle, exige `templateUrl` (adoção).
  - CLI: `apply --template <dir> --project <dir> --plan <arquivo.json>` (recusa árvore suja, imprime `ApplyReport`); `finish --project <dir> --template <dir> --target <tag> [--template-url <url>]` (data de hoje em `AAAA-MM-DD`).

- [ ] **Step 1: Testes que falham**
  - `write` copia bytes do alvo (inclui binário); `delete` remove; `move` grava o alvo no caminho novo e apaga o velho (cria diretórios).
  - `merge` sem conflito → arquivo juntado contém a mudança do projeto **e** a do template; listado em `merged`.
  - `merge` com conflito → arquivo com marcadores `<<<<<<< projeto`, em `conflicts` com `kind: 'markers'`.
  - `merge` de `package.json` sem marcadores mas JSON inválido → `kind: 'invalid-json'`.
  - `ask` não toca o arquivo; vai para `asked`.
  - árvore suja → CLI sai com código 1 e a mensagem exata das Global Constraints.
  - Review Focus 4: `plan` → `apply` → `finish` → commit → novo `plan` com o mesmo alvo → todas as entradas `action: 'none'`.
  - `finish` sem controle e sem `--template-url` → erro `Adoção: informe --template-url.`
  - `examplesNotes` com `hooks/protect-main/config.json` contendo `Walking Skeleton (example)` e projeto sem `examples/` → 1 nota.
- [ ] **Step 2: Rodar e ver falhar**; **Step 3: implementar**; **Step 4: rodar e ver passar** + lint/type-check.
- [ ] **Step 5: Commit** — `feat(template-sync): aplicar plano e registrar o lastSync`

---

### Task 4: Links de ADR e mudança dos ADRs do template para `docs/adr/template/`

**Files:**
- Create: `scripts/template-sync/links.mjs`, `tests/unit/docsLinks.test.ts`
- Modify: `scripts/template-sync/apply.mjs` (chama a reescrita para renomes de ADR), `scripts/template-sync.mjs` (subcomando `rewrite-links`)
- Move: `docs/adr/001…014-*.md` → `docs/adr/template/` (`git mv`); atualizar links em todo o repo (exceto `docs/superpowers/**` e `examples/**`, que são histórico/autocontidos)
- Test: `tests/unit/templateSyncLinks.test.ts`

**Interfaces:**
- Consumes: `applyPlan`/`ApplyReport` (Task 3), `renames` (Task 2).
- Produces:
  - `adrMoves(renames: Map<string,string>): Map<string,string>` — velho → novo, só onde o velho casa `docs/adr/*.md` (direto na pasta) e o novo está em `docs/adr/template/`.
  - `rewriteAdrLinks(text: string, filePath: string, moves: Map<string,string>): string` — troca `docs/adr/<nome>` por `docs/adr/template/<nome>` em qualquer arquivo; em arquivos **diretamente** em `docs/adr/`, troca também `(./<nome>` e `(<nome>` por `(./template/<nome>`. Só nomes presentes em `moves`.
  - `rewriteProjectLinks(projectDir: string, moves: Map<string,string>): string[]` — arquivos rastreados (`ls-files -z`) com extensão `.md .ts .tsx .mjs .js .json .yml .yaml`; devolve os alterados. `ApplyReport` ganha `linkRewrites: string[]`.
  - CLI: `rewrite-links --project <dir> --map <velho>=<novo> [--map …]` (adoção: cópias de ADR removidas).

- [ ] **Step 1: Testes de `rewriteAdrLinks`**

```ts
const moves = new Map([['docs/adr/005-trunk.md', 'docs/adr/template/005-trunk.md']])
expect(rewriteAdrLinks('[x](./docs/adr/005-trunk.md)', 'CLAUDE.md', moves)).toBe('[x](./docs/adr/template/005-trunk.md)')
expect(rewriteAdrLinks('[x](../../docs/adr/005-trunk.md)', 'src/a/b.ts', moves)).toBe('[x](../../docs/adr/template/005-trunk.md)')
expect(rewriteAdrLinks('[x](./005-trunk.md)', 'docs/adr/020-meu.md', moves)).toBe('[x](./template/005-trunk.md)')
expect(rewriteAdrLinks('[x](./014-perfil.md)', 'docs/adr/020-meu.md', moves)).toBe('[x](./014-perfil.md)') // ADR do projeto
expect(rewriteAdrLinks('[x](docs/adr/template/005-trunk.md)', 'CLAUDE.md', moves)).toBe('[x](docs/adr/template/005-trunk.md)') // idempotente
```

- [ ] **Step 2: Teste de integração** — sync com renome de ADR num projeto que tem `docs/adr/014-perfil.md` próprio linkando `./005-trunk.md` e `./013-x.md` (013 do projeto) → só o link do 005 muda; `linkRewrites` lista o arquivo.
- [ ] **Step 3: `docsLinks.test.ts`** — para todo `.md` rastreado fora de `docs/superpowers/**`, `examples/**` e `node_modules`, todo link relativo `](caminho)` (sem `http`, sem `#` puro; tira `#âncora`) aponta para arquivo/dir existente. Rodar antes da mudança: deve passar (se falhar por link já quebrado, corrigir o link no mesmo commit).
- [ ] **Step 4: Rodar e ver falhar** os testes de links; **Step 5: implementar** `links.mjs` e a integração no `apply`.
- [ ] **Step 6: Mover os ADRs do template** — `git mv docs/adr/0{01..14}-*.md docs/adr/template/`; rodar `node scripts/template-sync.mjs rewrite-links --project . --map …` (um `--map` por ADR) sobre o próprio repo; corrigir à mão os links **de saída** dos ADRs movidos (`../../X` → `../../../X`, `./000-template.md` → `../000-template.md`) até `docsLinks.test.ts` passar. Atualizar a seção "Criar ADR" do `CLAUDE.md`: ADR do template → `docs/adr/template/NNN-…` (só no repo do template); ADR do projeto → `docs/adr/NNN-…`, numeração livre.
- [ ] **Step 7: Rodar** `npm test`, lint, type-check, `npm run check:runbooks` → verdes; `rg -n "docs/adr/0(0[1-9]|1[0-4])-" --glob '!docs/superpowers/**' --glob '!examples/**'` → vazio.
- [ ] **Step 8: Commit** — `refactor(adr): adrs do template em docs/adr/template` (renome e reescrita num commit só, para o `git diff -M` dos projetos reconhecer o renome).

---

### Task 5: Versões, proposta de base, inventário e checagem agnóstica

**Files:**
- Create: `scripts/template-sync/versions.mjs`, `scripts/template-sync/inventory.mjs`
- Modify: `scripts/template-sync.mjs` (subcomandos `latest`, `propose-base`, `inventory`, `check-agnostic`)
- Test: `tests/unit/templateSyncVersions.test.ts`, `tests/unit/templateSyncInventory.test.ts`

**Interfaces:**
- Consumes: `treeBlobs`, `projectBlobs`, `git` (Task 2); `makeMatcher`, `readControl` (Task 1).
- Produces:
  - `latestRelease(templateDir: string): { tag: string, commit: string } | null` — maior tag `vX.Y.Z` por SemVer numérico (`commit` via `rev-list -n 1`).
  - `releasesAfter(templateDir: string, lastSync: Control['lastSync']): string[]` — tags (ordem crescente) cujo commit descende de `lastSync.commit` e é diferente dele (`merge-base --is-ancestor`); funciona com `version: null`.
  - `proposeBase(templateDir: string, projectDir: string, rev = 'HEAD'): { commit: string, date: string, identical: number, total: number }[]` — top 3 commits de `rev-list <rev>` por nº de arquivos (fora de `examples/**`) com blob idêntico ao projeto; empate → mais novo.
  - `inventory({ templateDir, projectDir }): { project: string, lastSync: Control['lastSync'] | null, behind: number | null, divergent: string[], own: { adrTitles: string[], files: string[] } }` — `divergent` = gerenciados do alvo onde o projeto difere (sem `projectOwned`); `own.adrTitles` = 1ª linha `# ` de `docs/adr/*.md` do projeto que não existem no alvo; `own.files` = rastreados em `scripts/`, `.github/workflows/`, `.claude/skills/`, `.claude/commands/`, `hooks/`, `docs/guides/`, `docs/runbooks/` fora do manifesto/alvo.
  - `findForbidden(text: string, terms: string[]): { term: string, line: number }[]` — case-insensitive, ignora termos vazios.
  - CLI: `latest --template <dir>`; `propose-base --template <dir> --project <dir>`; `inventory --template <dir> --project <dir>`; `check-agnostic --root <dir> --term <t> [--term …] [--files <a> …]` (sai 1 se achar).

- [ ] **Step 1: Testes que falham**
  - `latestRelease` com tags `v0.9.0`, `v0.10.0`, `nao-semver` → `v0.10.0`; sem tags → `null`.
  - `releasesAfter` com `version: null` e commit anterior a `v0.1.0`/`v0.2.0` → `['v0.1.0', 'v0.2.0']`; com `lastSync` no commit de `v0.2.0` → `[]`.
  - `proposeBase` num projeto copiado do 2º de 3 commits → 1º resultado é esse commit.
  - `inventory` aponta divergente, ADR próprio com título e workflow próprio; ignora `src/`.
  - `findForbidden('Projeto ContasMes\nok', ['contasmes', ''])` → `[{ term: 'contasmes', line: 1 }]`.
- [ ] **Step 2: Rodar e ver falhar**; **Step 3: implementar**; **Step 4: rodar e ver passar** + lint/type-check.
- [ ] **Step 5: Commit** — `feat(template-sync): versões, proposta de base e inventário`

---

### Task 6: Aviso semanal no projeto

**Files:**
- Create: `scripts/template-sync-check.mjs`, `.github/workflows/template-sync-check.yml`
- Test: `tests/unit/templateSyncCheck.test.ts`

**Interfaces:**
- Consumes: `makeGithubClient` (`scripts/github-api.mjs`), `parseControl`/`CONTROL_PATH` (Task 1).
- Produces:
  - `parseRepoUrl(url: string): string` — `https://github.com/<owner>/<repo>(.git)?` → `<owner>/<repo>`; outro formato lança.
  - `evaluateBehind({ lastSync, releases }: { lastSync, releases: { tag: string, body: string, after: boolean }[] }): { state: 'behind', title: string, body: string } | { state: 'current' }` — títulos exatos das Global Constraints; corpo = notas de cada Release do intervalo em ordem crescente (`## vX.Y.Z` + body) e o rodapé `Rode /template-sync no projeto para trazer as mudanças (abre um PR).`
  - `runCheck({ root, templateApi, projectApi }): Promise<'no-control' | 'current' | 'behind'>` — sem `.template-sync.json` → loga `Sem .template-sync.json (repositório do template ou projeto ainda não adotado): nada a fazer.` e devolve `'no-control'`; `behind` → cria ou edita (título + corpo) a issue aberta com rótulo `template-sync`; `current` → fecha a issue aberta, se houver, com comentário `Em dia com o template.`
  - `after` por Release: com `version` → SemVer maior que `lastSync.version`; com `null` → `GET /compare/{lastSync.commit}...{tag}` com `status === 'ahead'`.

- [ ] **Step 1: Testes que falham** — `evaluateBehind` (2 Releases depois, `version` não nula → título `Template: 2 versões atrás (v0.1.0 → v0.3.0)`; `version: null` → `(base anterior às Releases → v0.3.0)`; nenhuma depois → `current`); `runCheck` com APIs falsas: sem controle, cria issue, edita existente, fecha quando em dia; workflow (texto do yml): `schedule` com `cron`, `workflow_dispatch`, `permissions` exatamente `contents: read` e `issues: write`, roda `node scripts/template-sync-check.mjs` com `GITHUB_TOKEN`.
- [ ] **Step 2: Rodar e ver falhar**; **Step 3: implementar** (cron `'0 12 * * 1'`, Node 20, `actions/checkout@v5`/`setup-node@v5` como `release.yml`; `templateApi` usa o mesmo `GITHUB_TOKEN` — template público; privado é Item Futuro da spec); **Step 4: rodar e ver passar** + lint/type-check.
- [ ] **Step 5: Commit** — `feat(template-sync): aviso semanal de versões atrás`

---

### Task 7: Skill, ADR-015 e docs

**Files:**
- Create: `.claude/skills/template-sync/SKILL.md`, `docs/adr/template/015-template-sync.md`
- Modify: `CLAUDE.md` (adoção: rodar `/template-sync adotar`; estrutura cita a skill), `SKILLS.md` (linha em "Transversais"), `README.md`, `CONTRIBUTING.md`, `template-sync.manifest.json` (novos testes, se faltar algum)
- Test: `tests/unit/templateSyncSkill.test.ts`

**Interfaces:**
- Consumes: todos os subcomandos da CLI (Tasks 2–5) e o workflow (Task 6).

- [ ] **Step 1: Teste que falha** — `SKILL.md` tem frontmatter `name: template-sync` e `description` começando com `Use`; cita os 4 modos (`sync`, `adotar`, `contribuir`, `status`); cita cada subcomando usado (`plan`, `apply`, `finish`, `latest`, `propose-base`, `inventory`, `rewrite-links`, `check-agnostic`); contém `gh pr merge` só em frase de proibição. Nomes de conta/projeto **não** entram em teste versionado (o teste é gerenciado e iria para os projetos): a checagem agnóstica é o Step 5, pela CLI.
- [ ] **Step 2: Escrever a skill**, no estilo de `runbook-execution/SKILL.md` (Visão Geral, Checklist com uma tarefa por item, Red Flags). Conteúdo obrigatório por modo:
  - **sync** (no projeto): árvore limpa → `gh auth status --active` (regra 5) → branch `chore/template-sync-<vY>` → `git clone` do `template` do controle para dir temporário → `latest` → `git checkout <tag>` no clone → **rodar o motor do clone** (`node <clone>/scripts/template-sync.mjs …`) → `plan` → mostrar resumo → `apply` → resolver `conflicts` (preservar a intenção do projeto; runbooks: valores preenchidos do projeto prevalecem, só a estrutura nova entra; JSON precisa parsear) → perguntar os `asked` (uma mensagem só) → `npm install` se `package.json` mudou → `npm run lint`, `type-check`, `test`, `check:runbooks` → `finish` → commit → push + PR com o template de PR, UAT desmarcado, título `chore(template): sync vX → vY`, corpo com seções Aplicados / Juntados (com o porquê) / Perguntados / Links reescritos / Notas / **Candidatos a voltar ao template** → restaurar a conta padrão.
  - **adotar** (na sessão do template, `/template-sync adotar <caminho>`): pedir aprovação explícita antes de escrever no projeto; `propose-base` → humano confirma ou escolhe "sem base" (`--base none`) → fluxo do sync; propor remover ADRs do projeto que são cópia de ADR do template (+ `rewrite-links --map`); `finish --template-url` com a URL do template; título `chore(template): adota o template vY`.
  - **contribuir** (no projeto): generalizar (sem nome de projeto, conta, repo, segredo, valores de runbook); clone do template, branch `feat|docs/<assunto>`, aplicar, `check-agnostic` com nome do projeto, owner do remote e contas do `gh auth status` → PR no template com a conferência spec × código; nunca push na `main`.
  - **status** (na sessão do template): ler `~/.config/template-sync/projects.json` (`{ "projects": [{ "path": "/abs" }] }`; ausente → mostrar o formato e parar) → `inventory` por projeto (sem controle → `propose-base` para estimar) → Claude agrupa o que se repete em ≥ 2 projetos (já coberto pelo template → "adotar a versão do template") → criar/editar a issue `template-status` do template (`gh issue create|edit`, `gh issue pin`); nunca grava arquivo versionado com a lista.
- [ ] **Step 3: ADR-015** a partir de `docs/adr/000-template.md`: contexto (§1 da spec, sem nomes de projeto), decisão (pull por projeto via PR, 3 vias com base no `lastSync`, ADRs em `docs/adr/template/`, status fora do repo), consequências, alternativas (push do template com credencial nos projetos; sync por data; `git merge` de remote `template`).
- [ ] **Step 4: Docs** — `CLAUDE.md` adoção: novo parágrafo "**Adoção — sync com o template**: rode `/template-sync adotar` a partir do template; depois, `/template-sync` a cada Release (aviso semanal na issue `template-sync`)." `SKILLS.md`: linha `template-sync`. README/CONTRIBUTING: uma frase cada com link para o ADR-015.
- [ ] **Step 5: Rodar** `npm test`, lint, type-check, `check:runbooks` → verdes; `node scripts/template-sync.mjs check-agnostic --root . --files $(git diff --name-only main -- . ':!docs/superpowers') --term <conta-pessoal> --term <conta-corporativa> --term <nome de cada projeto derivado>` (termos passados só na linha de comando, pelo controlador) → nada encontrado.
- [ ] **Step 6: Commit** — `feat(template-sync): skill, adr-015 e docs`

---

### Task 8: Verificação de aceitação (sem escrever nos projetos)

- [ ] **Step 1:** `git clone` local do ContasMes.ai para `/tmp/ts-accept/contasmes` (cópia; o repo original não é tocado) e do template na branch atual para `/tmp/ts-accept/template`, com uma tag local `v0.2.0-rc` → `propose-base` → `plan --base <proposto>` → `apply` → conferir: ADRs viram `move`/`merge`, nenhum `delete` de ADR do projeto, links reescritos só para ADRs do template, `notes` aponta `Walking Skeleton (example)` se o projeto não tem `examples/`.
- [ ] **Step 2:** `finish` + commit no clone → novo `plan` → só `none` (critério "segundo sync sem nada a fazer").
- [ ] **Step 3:** registrar o resultado (contagens por `case`, problemas achados) no corpo do PR, na tabela spec × código. Problema achado → corrigir na task dona antes do PR.
- [ ] **Step 4:** apagar `/tmp/ts-accept`.
