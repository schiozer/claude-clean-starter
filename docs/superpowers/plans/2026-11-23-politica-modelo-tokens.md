# Política de modelo, esforço e tokens + read-guard — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar a política de modelo/esforço/tokens/subagentes (ADR 022 + guia) e barrar `Read` gigante com o hook `read-guard`.

**Architecture:** Hook `.mjs` em `hooks/read-guard/` (lógica pura em `evaluate.mjs`, entrada stdin em `run.mjs`, como `protect-main`), registrado em `.claude/settings.json`; testes Vitest em `tests/unit/`. Documentação em português: ADR do template + guia, com ponteiros no `CLAUDE.md` e `SKILLS.md`.

**Tech Stack:** Node ESM (`.mjs`), Vitest, Prettier, ESLint.

**Spec:** `docs/superpowers/specs/2026-11-23-politica-modelo-tokens-design.md`

## Global Constraints

- Limites: texto `TEXT_MAX_BYTES = 60 * 1024`; PDF `PDF_MAX_BYTES = 1024 * 1024`; timeout do hook `5`.
- Desligar com `READ_GUARD=off`; qualquer erro = sem saída (fail-open); imagens (`png|jpe?g|gif|webp|svg`) e `ipynb` nunca bloqueiam.
- Sem dependências novas; sem `any`; sem `;`, aspas simples, `printWidth` 100 (Prettier).
- Nada de `model`/`effortLevel`/IDs de modelo em `.claude/settings.json`.
- Documentos em português (Brasil). Não editar `hooks/protect-main`, `.githooks/` nem o registro existente do `protect-main`.
- Commits `tipo(escopo): mensagem`; PR com base `main`, título `feat(...)`, UAT desmarcado; nunca `gh pr merge`.

## Review Focus

- Arquivo de 60 KB exatos (limite): passa; 60 KB + 1: nega.
- `offset: 0`/`limit: 0` (valores "vazios") não contam como fatia.
- `pages` só com espaços não conta como fatia.
- Caminho relativo e `cwd` ausente no payload.
- Payload vazio ou JSON inválido: sem saída, exit 0.

---

### Task 1: Hook `read-guard` (TDD) e registro

**Files:**

- Create: `hooks/read-guard/evaluate.mjs`, `hooks/read-guard/run.mjs`, `hooks/read-guard/README.md`
- Modify: `.claude/settings.json` (novo item em `PreToolUse`), `template-sync.manifest.json` (adicionar `tests/unit/readGuard.test.ts` à lista `managed`, em ordem alfabética)
- Test: `tests/unit/readGuard.test.ts`

**Interfaces:**

- Produces: `evaluate.mjs` exporta `TEXT_MAX_BYTES`, `PDF_MAX_BYTES`, `classifyRead(toolInput: unknown, cwd: string): string | null` (motivo do bloqueio ou `null`) e `evaluateRead(raw: string, env?: NodeJS.ProcessEnv, cwdFallback?: string): string` (JSON `hookSpecificOutput` com `permissionDecision: 'deny'` e `permissionDecisionReason`, ou `''`). `run.mjs` lê stdin, chama `evaluateRead` e escreve a saída; sempre exit 0.

- [ ] **Step 1: Escrever o teste falhando** em `tests/unit/readGuard.test.ts`, usando diretório temporário (`mkdtempSync`) e arquivos com `Buffer.alloc(n, 'a')`. Casos (nomes e asserts):
  - `nega texto acima de 60 KB sem fatia`: `classifyRead({ file_path: grande }, dir)` casa `/offset\/limit/`; arquivo de exatos `TEXT_MAX_BYTES` → `null`.
  - `deixa passar fatia, arquivo pequeno, inexistente, entrada inválida`: `limit: 200`, `offset: 10`, pequeno, `join(dir,'x.txt')`, `{}`, `null` → `null`; `offset: 0` e `limit: 0` sobre arquivo grande → ainda casa `/offset\/limit/`.
  - `ignora imagens e notebooks de qualquer tamanho`: `a.png`, `a.JPG`, `a.svg`, `a.ipynb` com `TEXT_MAX_BYTES * 2` → `null`.
  - `resolve caminho relativo contra cwd`: `classifyRead({ file_path: 'grande.log' }, dir)` não é `null`.
  - `PDF ≥ 1 MB sem pages nega com receita pdftotext`: casa `/pdftotext/`; com `pages: '1-5'` → `null`; `pages: '  '` ainda nega; `PDF_MAX_BYTES - 1` → `null`; PDF de `TEXT_MAX_BYTES * 3` → `null` (regra de PDF, não de texto).
  - `evaluateRead emite deny só para Read`: payload `{ tool_name: 'Read', tool_input: { file_path }, cwd: dir }` → JSON com `hookSpecificOutput.permissionDecision === 'deny'` e `hookEventName === 'PreToolUse'`; `tool_name: 'Grep'` → `''`.
  - `READ_GUARD=off, JSON inválido e vazio não opinam`: `evaluateRead(raw, { READ_GUARD: 'off' })`, `'not json'`, `''` → `''`.

- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run tests/unit/readGuard.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `hooks/read-guard/evaluate.mjs`** conforme a interface. `present(v)` = não `undefined/null/''/0`; PDF avaliado antes (só `pages` não vazio após `trim` o libera); mensagens em português com as dicas `rg -n` + `Read` com `offset`/`limit` (ou delegar a subagente que devolve resumo) e `pdftotext -layout` / `pages`. Comentário de cabeçalho no estilo de `protect-main/run.mjs` apontando para o guia.

- [ ] **Step 4: Implementar `hooks/read-guard/run.mjs`** (`#!/usr/bin/env node`; `readFileSync(0, 'utf8')` em `try/catch`; escreve a saída de `evaluateRead(raw)` se não vazia). Escrever `README.md` curto (tabela de casos, `READ_GUARD=off`, limites no topo de `evaluate.mjs`, link para o guia).

- [ ] **Step 5: Registrar** em `.claude/settings.json`: novo item em `PreToolUse` com `matcher: "Read"` e comando `node "$CLAUDE_PROJECT_DIR/hooks/read-guard/run.mjs"`, `timeout: 5`. Adicionar o teste ao `managed` do manifesto.

- [ ] **Step 6: Verificar:** `npx vitest run tests/unit/readGuard.test.ts tests/unit/templateSyncManifest.test.ts` → PASS; `npm run lint && npm run type-check` → sem erros; teste manual: `echo '{"tool_name":"Read","tool_input":{"file_path":"package-lock.json"},"cwd":"."}' | node hooks/read-guard/run.mjs` → JSON com `deny` (se o arquivo > 60 KB).

- [ ] **Step 7: Commit:** `git add hooks/read-guard tests/unit/readGuard.test.ts .claude/settings.json template-sync.manifest.json && git commit -m "feat(hooks): read-guard barra read gigante sem fatia"`

### Task 2: ADR 022, guia e ponteiros

**Files:**

- Create: `docs/adr/template/022-politica-de-modelo-esforco-e-tokens.md` (a partir de `docs/adr/000-template.md`, status Aceito), `docs/guides/model-effort-tokens-guide.md`
- Modify: `CLAUDE.md` (seção "Guias Técnicos": um item), `SKILLS.md:57` (trocar "Alternativa: despacha subagentes em paralelo por tarefa." pela regra de subagentes por fase, com link ao guia)

**Interfaces:**

- Consumes: hook da Task 1 (guia cita `hooks/read-guard/`, `READ_GUARD=off`, limites).

- [ ] **Step 1: Escrever o ADR** com Contexto / Decisão / Consequências / Alternativas (itens da seção 4 e 3 da spec; cita a PR #295 do `template-adp` apenas como origem das ideias).

- [ ] **Step 2: Escrever o guia** (português) com as seções da spec: modelo por tarefa; esforço; resolução de modelo de subagente e pin de aliases (tabela de variáveis, sem IDs); subagentes por fase (spec/plano na sessão principal, implementação Sonnet por tarefa, revisão Opus, subagente nunca faz push/PR/merge); disciplina de tokens; template de briefing; receitas `/goal` (`npm test`, `npm run lint`, `npm run check:cenarios`, sempre com limite de turnos) e `/loop` (`gh pr checks <n>` somente leitura); `read-guard`; sugestão (não instalada) de `## Compact instructions`. Aviso de que flags e defaults mudam com as versões do Claude Code (conferir a documentação oficial).

- [ ] **Step 3: Ponteiros:** item no `CLAUDE.md` ("Modelo, esforço e tokens → guia") e ajuste do `SKILLS.md:57`.

- [ ] **Step 4: Verificar:** `npx vitest run tests/unit/docsLinks.test.ts` → PASS (links válidos); `npx prettier --check docs CLAUDE.md SKILLS.md hooks` → ok (senão `npx prettier --write` nos arquivos tocados).

- [ ] **Step 5: Commit:** `git add docs CLAUDE.md SKILLS.md && git commit -m "docs(ia): adr 022 e guia de modelo, esforço e tokens"`

### Task 3: Verificação final e PR

- [ ] **Step 1:** Conferir a spec × diff (cada critério da seção 7 da spec); `npm run lint && npm run type-check && npm test` → verdes (skill `superpowers:verification-before-completion`).
- [ ] **Step 2:** Conta git: `gh auth status --active`; trocar para `schiozer` antes do push e restaurar `fschiozerSFDC` depois (memória/regra 5).
- [ ] **Step 3:** `git push -u origin feature/politica-modelo-tokens` e `gh pr create` com o template `.github/pull_request_template.md` preenchido (tabela spec × código, UAT desmarcado). Avisar o humano; o merge é dele.
