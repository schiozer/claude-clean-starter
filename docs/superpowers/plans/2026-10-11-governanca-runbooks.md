# Governança operacional e runbooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar ADR-013, catálogo de runbooks executáveis por agentes, o validador
`check:runbooks` (com CI) e a skill `runbook-execution`, integrados ao CLAUDE.md/SKILLS.md.

**Architecture:** Regras em ADR; runbooks em `docs/runbooks/` num formato rígido (metadados +
7 seções H2 + passos numerados com classe `[R0]`–`[R3]` e `Verificar:`); um script ESM sem
dependências valida formato e catálogo (modo normal no template, `--strict` no projeto
adotado); a skill ensina o agente a executar qualquer runbook com os gates.

**Tech Stack:** Node 20 (ESM `.mjs`), Vitest 2 (raiz), GitHub Actions, Markdown.

**Spec:** `docs/superpowers/specs/2026-10-11-governanca-runbooks-design.md`

## Global Constraints

- Idioma pt-BR em docs, commits e mensagens do validador.
- Commits `tipo(escopo): mensagem`, ≤72 chars, terminando com
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Validador sem dependências novas; CLI `node scripts/check-runbooks.mjs [--strict] [dir=docs/runbooks]`, exit 1 com erros.
- Seções H2 exatas e em ordem: Objetivo, Pré-condições, Pre-flight, Passos, Verificação final, Rollback, Registro.
- Metadados: `**Responsável**:`, `**Última verificação**:`, `**Ambientes**:` (lista por vírgula de `Dev`, `UAT`, `Prod`).
- Placeholder canônico: `<preencher` (ex.: `<preencher: team Vercel>`).
- Catálogo obrigatório: `bootstrap-ambientes.md`, `deploy-uat.md`, `deploy-prod.md`, `rollback.md`, `migracao-banco.md`, `segredos-e-env.md`, `feature-flags.md`, `mcp-habilitar-e-conectar.md` + `README.md` + `_TEMPLATE.md`.
- Merge na `main` aparece só como `[R3] Humano:`. Nenhum runbook faz o agente ler/imprimir segredo.
- Frescor: 90 dias (aplicado pela skill, não pelo CI).

## Review Focus

1. Bloco de código dentro de um passo com linhas `## …` ou `1. …` → não pode virar seção nem passo (teste em Task 1).
2. Arquivo com CRLF → mesmas regras valem (teste em Task 1).
3. `--strict` com data impossível (`2026-13-45`, `2026-02-30`) → erro, nunca exceção (teste em Task 1).
4. `Verificar:` num parágrafo solto depois da lista não conta para o passo anterior (teste em Task 1).
5. Seção H2 duplicada → erro de ordem (teste em Task 1).

---

### Task 1: Validador `check-runbooks` + script + CI

**Files:**
- Create: `scripts/check-runbooks.mjs`
- Create: `tests/unit/checkRunbooks.test.ts`
- Modify: `package.json` (script `check:runbooks`)
- Modify: `.github/workflows/ci.yml` (passo no job `test`)

**Interfaces:**
- Produces: `checkRunbook(markdown: string, opts?: { strict?: boolean }): string[]`,
  `checkCatalog(dir: string, opts?: { strict?: boolean }): string[]` (erros prefixados por
  `<arquivo>: `), `REQUIRED_RUNBOOKS: string[]`, `SECTIONS: string[]`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/checkRunbooks.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRunbook, checkCatalog, REQUIRED_RUNBOOKS } from '../../scripts/check-runbooks.mjs'

const VALID = `# Runbook: Exemplo

**Responsável**: time-plataforma
**Última verificação**: 2026-10-01
**Ambientes**: UAT, Prod

## Objetivo

Fazer algo.

## Pré-condições

- PR aberto.

## Pre-flight

1. [R0] Conferir a conta: \`gh auth status --active\`.

## Passos

1. [R1] Abrir o PR: \`gh pr create\`.
   Verificar: \`gh pr view\` mostra o PR aberto.
2. [R3] Humano: fazer o merge do PR.
   Verificar: \`gh pr view --json state\` → \`MERGED\`.

## Verificação final

- Smoke test ok.

## Rollback

1. [R2] Promover o deploy anterior.
   Verificar: a URL de Prod responde 200.

## Registro

Comentário no PR.
`

const swap = (from: string, to: string) => VALID.replace(from, to)

describe('checkRunbook', () => {
  it('runbook válido → sem erros (normal e estrito)', () => {
    expect(checkRunbook(VALID)).toEqual([])
    expect(checkRunbook(VALID, { strict: true })).toEqual([])
  })

  it('metadado ausente → erro', () => {
    expect(checkRunbook(swap('**Responsável**: time-plataforma\n', ''))).toContain(
      'metadado ausente: **Responsável**'
    )
  })

  it('ambiente inválido ou repetido → erro', () => {
    expect(checkRunbook(swap('UAT, Prod', 'UAT, Staging')).join()).toContain('Ambientes inválidos: Staging')
    expect(checkRunbook(swap('UAT, Prod', 'UAT, UAT'))).toContain('Ambientes repetidos')
  })

  it('seção ausente → erro', () => {
    expect(checkRunbook(swap('## Registro\n\nComentário no PR.\n', ''))).toContain('seção ausente: ## Registro')
  })

  it('seções fora de ordem → erro', () => {
    const moved = swap('## Objetivo\n\nFazer algo.\n\n', '') + '\n## Objetivo\n\nFazer algo.\n'
    expect(checkRunbook(moved).join()).toContain('seções fora de ordem')
  })

  it('seção duplicada → erro de ordem', () => {
    expect(checkRunbook(VALID + '\n## Objetivo\n\nDe novo.\n').join()).toContain('seções fora de ordem')
  })

  it('passo sem classe de risco → erro', () => {
    expect(checkRunbook(swap('1. [R0] Conferir', '1. Conferir')).join()).toContain(
      'passo sem classe de risco [R0]–[R3]'
    )
  })

  it('passo de Passos sem Verificar: → erro', () => {
    expect(checkRunbook(swap('   Verificar: `gh pr view` mostra o PR aberto.\n', '')).join()).toContain(
      'passo sem "Verificar:"'
    )
  })

  it('[R3] sem "Humano:" → erro', () => {
    expect(checkRunbook(swap('[R3] Humano: fazer', '[R3] Fazer')).join()).toContain(
      'passo [R3] deve começar com "[R3] Humano:"'
    )
  })

  it('seção de passos vazia → erro', () => {
    const empty = swap('1. [R2] Promover o deploy anterior.\n   Verificar: a URL de Prod responde 200.\n', 'Nada.\n')
    expect(checkRunbook(empty)).toContain('## Rollback: nenhum passo numerado')
  })

  it('Verificar: em parágrafo solto após a lista não conta para o passo', () => {
    const loose = swap(
      '1. [R2] Promover o deploy anterior.\n   Verificar: a URL de Prod responde 200.\n',
      '1. [R2] Promover o deploy anterior.\n\nVerificar: solto.\n'
    )
    expect(checkRunbook(loose).join()).toContain('passo sem "Verificar:"')
  })

  it('bloco de código com "## " e "1. " não vira seção nem passo', () => {
    const fenced = swap(
      '   Verificar: `gh pr view` mostra o PR aberto.\n',
      '   Verificar: saída abaixo.\n   ```\n## Nao e secao\n1. nao e passo\n   ```\n'
    )
    expect(checkRunbook(fenced)).toEqual([])
  })

  it('CRLF → mesmas regras', () => {
    expect(checkRunbook(VALID.replace(/\n/g, '\r\n'))).toEqual([])
  })

  it('não-estrito aceita <preencher; estrito rejeita com a linha', () => {
    const ph = swap('time-plataforma', '<preencher: time>')
    expect(checkRunbook(ph)).toEqual([])
    expect(checkRunbook(ph, { strict: true })).toContain('linha 3: placeholder <preencher> pendente')
  })

  it.each(['AAAA-MM-DD', '2026-13-45', '2026-02-30', '01/10/2026'])(
    'estrito rejeita data inválida %s sem lançar',
    (date) => {
      const errors = checkRunbook(swap('2026-10-01', date), { strict: true })
      expect(errors).toContain(`Última verificação inválida: "${date}" (use AAAA-MM-DD)`)
    }
  )
})

describe('checkCatalog', () => {
  let dir: string
  const writeAll = () => {
    writeFileSync(join(dir, 'README.md'), '# Runbooks\n')
    writeFileSync(join(dir, '_TEMPLATE.md'), '# Runbook: <preencher>\n')
    for (const f of REQUIRED_RUNBOOKS) writeFileSync(join(dir, f), VALID)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runbooks-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('catálogo completo e válido → sem erros (README e _TEMPLATE não são validados)', () => {
    writeAll()
    expect(checkCatalog(dir, { strict: true })).toEqual([])
  })

  it('runbook obrigatório ausente → erro', () => {
    writeAll()
    rmSync(join(dir, 'rollback.md'))
    expect(checkCatalog(dir)).toContain('rollback.md: arquivo obrigatório ausente do catálogo')
  })

  it('runbook extra inválido → erro com o nome do arquivo', () => {
    writeAll()
    writeFileSync(join(dir, 'extra.md'), '# Runbook: extra\n')
    expect(checkCatalog(dir)).toContain('extra.md: metadado ausente: **Responsável**')
  })

  it('diretório inexistente → erro', () => {
    expect(checkCatalog(join(dir, 'nao-existe'))[0]).toContain('diretório de runbooks não encontrado')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/checkRunbooks.test.ts > /tmp/rb1.log 2>&1; tail -15 /tmp/rb1.log`
Expected: FAIL — cannot resolve `../../scripts/check-runbooks.mjs`.

- [ ] **Step 3: Implement** — `scripts/check-runbooks.mjs`:

```js
// Valida o formato e o catálogo de runbooks (ADR-013).
// Uso: node scripts/check-runbooks.mjs [--strict] [dir=docs/runbooks]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const REQUIRED_RUNBOOKS = [
  'bootstrap-ambientes.md',
  'deploy-uat.md',
  'deploy-prod.md',
  'rollback.md',
  'migracao-banco.md',
  'segredos-e-env.md',
  'feature-flags.md',
  'mcp-habilitar-e-conectar.md',
]
export const SECTIONS = [
  'Objetivo',
  'Pré-condições',
  'Pre-flight',
  'Passos',
  'Verificação final',
  'Rollback',
  'Registro',
]
const CATALOG_FILES = ['README.md', '_TEMPLATE.md']
const META_KEYS = ['Responsável', 'Última verificação', 'Ambientes']
const STEP_SECTIONS = ['Pre-flight', 'Passos', 'Rollback']
const VERIFY_SECTIONS = ['Passos', 'Rollback']
const ENVIRONMENTS = ['Dev', 'UAT', 'Prod']
const PLACEHOLDER = '<preencher'

function parse(markdown) {
  const meta = {}
  const sections = []
  let current = null
  let inFence = false
  for (const text of markdown.split(/\r?\n/)) {
    const isFence = text.trimStart().startsWith('```')
    const code = inFence || isFence
    if (isFence) inFence = !inFence
    if (!code) {
      const heading = /^## (.+?)\s*$/.exec(text)
      if (heading) {
        current = { title: heading[1], lines: [] }
        sections.push(current)
        continue
      }
      const metaLine = /^\*\*(.+?)\*\*:\s*(.*?)\s*$/.exec(text)
      if (!current && metaLine && META_KEYS.includes(metaLine[1])) {
        meta[metaLine[1]] = metaLine[2]
        continue
      }
    }
    if (current) current.lines.push({ text, code })
  }
  return { meta, sections }
}

// Item numerado de topo + continuação (linhas indentadas, em branco ou de código).
// Um parágrafo não indentado encerra o item.
function steps(section) {
  const items = []
  let open = false
  for (const { text, code } of section.lines) {
    if (!code && /^\d+\.\s/.test(text)) {
      items.push({ head: text, body: text })
      open = true
    } else if (open && (code || text.trim() === '' || /^\s/.test(text))) {
      items[items.length - 1].body += `\n${text}`
    } else if (text.trim() !== '') {
      open = false
    }
  }
  return items
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function checkMeta(meta, errors) {
  for (const key of META_KEYS) if (!meta[key]) errors.push(`metadado ausente: **${key}**`)
  if (!meta.Ambientes) return
  const envs = meta.Ambientes.split(',').map((env) => env.trim())
  const invalid = envs.filter((env) => !ENVIRONMENTS.includes(env))
  if (invalid.length) errors.push(`Ambientes inválidos: ${invalid.join(', ')} (use Dev, UAT, Prod)`)
  if (new Set(envs).size !== envs.length) errors.push('Ambientes repetidos')
}

function checkSections(sections, errors) {
  const titles = sections.map((s) => s.title).filter((t) => SECTIONS.includes(t))
  const missing = SECTIONS.filter((t) => !titles.includes(t))
  for (const title of missing) errors.push(`seção ausente: ## ${title}`)
  if (!missing.length && titles.join('|') !== SECTIONS.join('|')) {
    errors.push(`seções fora de ordem ou duplicadas; esperado: ${SECTIONS.join(' → ')}`)
  }
}

function checkSteps(sections, errors) {
  for (const section of sections.filter((s) => STEP_SECTIONS.includes(s.title))) {
    const items = steps(section)
    if (!items.length) errors.push(`## ${section.title}: nenhum passo numerado`)
    for (const item of items) {
      const label = `## ${section.title} › ${item.head.trim().slice(0, 60)}`
      const tag = /^\d+\.\s+\[R([0-3])\]/.exec(item.head)
      if (!tag) {
        errors.push(`${label}: passo sem classe de risco [R0]–[R3]`)
        continue
      }
      if (tag[1] === '3' && !/^\d+\.\s+\[R3\] Humano:/.test(item.head)) {
        errors.push(`${label}: passo [R3] deve começar com "[R3] Humano:"`)
      }
      if (VERIFY_SECTIONS.includes(section.title) && !item.body.includes('Verificar:')) {
        errors.push(`${label}: passo sem "Verificar:"`)
      }
    }
  }
}

function checkStrict(markdown, meta, errors) {
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(PLACEHOLDER)) errors.push(`linha ${index + 1}: placeholder <preencher> pendente`)
  })
  const date = meta['Última verificação']
  if (date && !isIsoDate(date)) errors.push(`Última verificação inválida: "${date}" (use AAAA-MM-DD)`)
}

export function checkRunbook(markdown, { strict = false } = {}) {
  const errors = []
  const { meta, sections } = parse(markdown)
  checkMeta(meta, errors)
  checkSections(sections, errors)
  checkSteps(sections, errors)
  if (strict) checkStrict(markdown, meta, errors)
  return errors
}

export function checkCatalog(dir, { strict = false } = {}) {
  if (!existsSync(dir)) return [`${dir}: diretório de runbooks não encontrado`]
  const files = readdirSync(dir).filter((file) => file.endsWith('.md'))
  const errors = []
  for (const file of [...CATALOG_FILES, ...REQUIRED_RUNBOOKS]) {
    if (!files.includes(file)) errors.push(`${file}: arquivo obrigatório ausente do catálogo`)
  }
  for (const file of files.filter((f) => !CATALOG_FILES.includes(f)).sort()) {
    for (const error of checkRunbook(readFileSync(join(dir, file), 'utf8'), { strict })) {
      errors.push(`${file}: ${error}`)
    }
  }
  return errors
}

function main(argv) {
  const strict = argv.includes('--strict')
  const dir = resolve(argv.find((arg) => !arg.startsWith('--')) ?? 'docs/runbooks')
  const mode = strict ? ' (modo estrito)' : ''
  const errors = checkCatalog(dir, { strict })
  if (errors.length) {
    console.error(`check-runbooks: ${errors.length} problema(s)${mode}`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }
  console.log(`check-runbooks: ok${mode}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/checkRunbooks.test.ts > /tmp/rb1.log 2>&1; tail -15 /tmp/rb1.log`
Expected: PASS, todos os testes.

- [ ] **Step 5: Wire script + CI.** Em `package.json` → `scripts`, adicionar
  `"check:runbooks": "node scripts/check-runbooks.mjs"`. Em `.github/workflows/ci.yml`, job
  `test`, após "Run tests":

```yaml
      - name: Check runbooks (ADR-013)
        # Projeto adotado: troque por `npm run check:runbooks -- --strict`.
        run: npm run check:runbooks
```

- [ ] **Step 6: Lint/type-check**

Run: `npm run lint > /tmp/rb1.log 2>&1 && npm run type-check >> /tmp/rb1.log 2>&1; echo $?; tail -15 /tmp/rb1.log`
Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-runbooks.mjs tests/unit/checkRunbooks.test.ts package.json .github/workflows/ci.yml
git commit -m "feat(runbooks): validador de formato e catálogo de runbooks"
```

---

### Task 2: ADR-013 + README e template de runbooks

**Files:**
- Create: `docs/adr/013-governanca-operacional-e-runbooks.md`
- Create: `docs/runbooks/README.md`
- Create: `docs/runbooks/_TEMPLATE.md`
- Modify: spec `Status: Rascunho` → `Aprovada`

**Interfaces:**
- Consumes: formato/seções de Task 1 (Global Constraints).
- Produces: ADR-013 (referenciado por runbooks, skill, CLAUDE.md).

- [ ] **Step 1: ADR-013** (formato de `000-template.md`, Status Aceito, Data 2026-10-11):
  - **Contexto:** agentes passam a operar deploy/config; ADRs 002–006/008/012 definem
    comportamento mas não *quem pode fazer o quê*; template sem infra → regras + catálogo.
  - **Decisão:** (1) toda operação via runbook do catálogo + skill `runbook-execution`;
    (2) tabela R0–R3 da spec 5.1 verbatim, regra de elevação; (3) protocolo R2 (spec 5.2);
    (4) regras transversais (spec 5.3: pre-flight, segredos, rollback, frescor 90 dias,
    placeholders, desvio); (5) registro (spec 5.4); (6) formato + validador (5.5);
    (7) obrigação de adoção (5.7).
  - **Consequências:** + previsível, auditável, CI verifica; − cerimônia por operação,
    runbooks envelhecem (mitigado por frescor), aprovação no chat não é assinatura forte.
  - **Alternativas:** agente autônomo até Prod (descartado: merge=Prod sem humano);
    humano aprova tudo (descartado: trava UAT); runbooks como skills (descartado: acopla ao
    Claude Code e mistura operação com desenvolvimento); IaC agora (adiado, Itens Futuros).

- [ ] **Step 2: `_TEMPLATE.md`** — o formato da spec 5.5 com instruções curtas em cada
  seção (blockquote), exemplo de passo de cada classe, `Verificar:` em linha indentada sob o
  passo, e nota "remova estas instruções ao copiar".

- [ ] **Step 3: `README.md`** — o que são; tabela do catálogo (arquivo → quando usar);
  resumo R0–R3 + elevação (link ADR-013); como executar ("peça ao agente; ele usa a skill
  `runbook-execution`"); como criar um novo (copiar `_TEMPLATE.md`); validação
  (`npm run check:runbooks`, `-- --strict` na adoção); checklist de adoção (spec 5.7).

- [ ] **Step 4: Spec → Aprovada.**

- [ ] **Step 5: Commit**

```bash
git add docs/adr/013-governanca-operacional-e-runbooks.md docs/runbooks/README.md docs/runbooks/_TEMPLATE.md docs/superpowers/specs/2026-10-11-governanca-runbooks-design.md
git commit -m "docs(adr): ADR-013 governança operacional e formato de runbook"
```

---

### Task 3: Runbooks de deploy, rollback e flags

**Files:** Create `docs/runbooks/{deploy-uat,deploy-prod,rollback,feature-flags}.md`

Cada um com metadados (`Responsável: <preencher: pessoa/time>`, `Última verificação: AAAA-MM-DD`),
todas as 7 seções, todo passo com classe e `Verificar:`. Pre-flight padrão (R0):
`gh auth status --active` (conta do repo, regra 5), `vercel whoami` + `vercel switch
<preencher: team>`→ só conferir scope com `vercel project ls --scope <preencher: team>`.

- [ ] **Step 1: `deploy-uat.md`** (Ambientes: UAT). Passos: [R0] `git status` limpo e branch
  ≠ `main`; [R0] `npm run lint && npm run type-check && npm test`; [R1] push da branch
  (`git push -u origin <branch>`); [R1] `gh pr create` (ou PR existente atualizado);
  [R0] `gh pr checks --watch` verde; [R0] preview pronto (`vercel ls --scope …` / comentário
  do bot no PR); [R1] apontar alias estável do UAT `vercel alias set <preview-url>
  <preencher: alias UAT>`; [R0] smoke test (`curl -sI https://<alias>/` 200;
  `/api/mcp` sem token → 401). Verificação final: URL do UAT informada ao humano. Rollback:
  [R1] reapontar alias para o preview anterior; [R1] fechar/atualizar PR. Registro: comentário no PR.

- [ ] **Step 2: `deploy-prod.md`** (Ambientes: Prod). Pré-condições: UAT aprovado pelo humano,
  migração aditiva já aplicada em Prod (ADR-008, `migracao-banco.md`). Passos: [R0] PR verde e
  atualizado (`gh pr view --json mergeable,mergeStateStatus,statusCheckRollup`); [R0] confirmar
  aprovação de UAT registrada no PR; [R3] Humano: fazer o merge do PR na `main`; [R0]
  acompanhar deploy de Produção (`vercel ls --prod --scope …` até `Ready`); [R0] smoke test em
  Prod. Rollback: seguir `rollback.md` (passo [R2] promover deploy anterior com
  `vercel rollback <deploy-anterior> --scope …`). Registro: comentário no PR mergeado.

- [ ] **Step 3: `rollback.md`** (Ambientes: UAT, Prod). Objetivo: primeira resposta a
  incidente, do menos ao mais invasivo. Passos: [R0] identificar deploy/feature suspeita
  (`vercel ls`, logs `vercel logs <url>`); [R2] desligar a flag da feature
  (`<CTX>_ENABLED=off`, via `feature-flags.md`) — kill switch também das tools MCP;
  [R2] promover deploy anterior (`vercel rollback <deploy> --scope …` ou `vercel promote`);
  [R1] abrir PR de revert (`git revert <sha>` em branch + `gh pr create`); [R3] Humano: merge
  do PR de revert. Verificação final: smoke test ok, incidente comunicado. Rollback (do
  rollback): [R2] reverter a promoção se piorou (`vercel promote <deploy-atual>`).
  Registro: issue `ops` de incidente.

- [ ] **Step 4: `feature-flags.md`** (Ambientes: Dev, UAT, Prod). Explicar flags do skeleton
  (`RESOURCES_ENABLED` pai, `MCP_RESOURCES_READ`, `MCP_RESOURCES_WRITE`; genérico
  `<CTX>_ENABLED`, `MCP_<CTX>_READ|WRITE`). Passos: [R0] listar envs por nome
  (`vercel env ls <ambiente> --scope …`); [R1] ligar/desligar flag em Dev/UAT
  (`vercel env rm`/`vercel env add <FLAG> preview` com valor `on|off` — flag não é segredo);
  [R2] mesma operação em Prod; [R2] ligar `MCP_<CTX>_WRITE` em qualquer ambiente; [R1]
  redeploy do ambiente (`vercel redeploy <url>`; Prod → [R2]); [R0] verificação: página/rota
  (`/api/<ctx>` 404 desligado) e `tools/list` via MCP Inspector. Rollback: [R1]/[R2] valor
  anterior + redeploy.

- [ ] **Step 5: Validar cada arquivo**

Run: `node -e "import('./scripts/check-runbooks.mjs').then(m=>{for(const f of ['deploy-uat','deploy-prod','rollback','feature-flags']){const e=m.checkRunbook(require('fs').readFileSync('docs/runbooks/'+f+'.md','utf8'));console.log(f,e.length?e:'ok')}})"`
Expected: os 4 `ok`.

- [ ] **Step 6: Commit**

```bash
git add docs/runbooks
git commit -m "docs(runbooks): deploy UAT/Prod, rollback e feature flags"
```

---

### Task 4: Runbooks de bootstrap, banco, segredos e MCP + teste do catálogo real

**Files:**
- Create `docs/runbooks/{bootstrap-ambientes,migracao-banco,segredos-e-env,mcp-habilitar-e-conectar}.md`
- Modify `tests/unit/checkRunbooks.test.ts` (catálogo real)

- [ ] **Step 1: Teste do catálogo real (falha: faltam 4 runbooks)** — adicionar:

```ts
describe('catálogo do template (docs/runbooks)', () => {
  it('passa no modo normal', () => {
    expect(checkCatalog(join(process.cwd(), 'docs/runbooks'))).toEqual([])
  })

  it('falha no modo estrito enquanto houver <preencher>', () => {
    expect(checkCatalog(join(process.cwd(), 'docs/runbooks'), { strict: true }).join()).toContain(
      'placeholder <preencher> pendente'
    )
  })
})
```

Run: `npx vitest run tests/unit/checkRunbooks.test.ts > /tmp/rb4.log 2>&1; tail -15 /tmp/rb4.log`
Expected: FAIL — `bootstrap-ambientes.md: arquivo obrigatório ausente do catálogo` etc.

- [ ] **Step 2: `bootstrap-ambientes.md`** (Dev, UAT, Prod). Passos: [R2] criar projeto Vercel
  ligado ao repo (`vercel link` / dashboard) — cria recurso externo; [R2] instalar integração
  Vercel↔Neon (branch por preview, ADR-003); [R2] criar branches Neon `dev`/`uat` a partir de
  `main` (Prod) (`neonctl branches create --name uat --project-id <preencher>`);
  [R2] criar tenants Auth0 por ambiente (ADR-004; dashboard — humano); [R1] envs não-secretas
  por ambiente (`APP_ENV`, `MCP_RESOURCE_URL`, flags) em Dev/UAT; [R2] envs de Prod e todos os
  segredos via `segredos-e-env.md`; [R1] alias estável do UAT; [R3] Humano: branch protection na
  `main` com required checks (`Test & Lint (root)`, `Walking Skeleton (example)`). Verificação
  final: `vercel env ls` lista os nomes esperados por ambiente; `neonctl branches list`;
  Rollback: [R2] remover recursos criados (destrutivo).

- [ ] **Step 3: `migracao-banco.md`** (Dev, UAT, Prod). ADR-008: SQL à mão em
  `drizzle/NNNN_nome.sql`, aplicador `node scripts/apply-migration.mjs <arquivo> --env <arquivo-env>`;
  `drizzle-kit push` proibido. Passos: [R1] aplicar em branch Neon de preview/dev; [R0]
  verificar schema (`\d tabela` via `psql`/`neonctl` ou query `information_schema`); [R1]
  aplicar em UAT; [R2] criar branch Neon de backup de Prod (`neonctl branches create --name
  backup-<data> --parent main`); [R2] aplicar em Prod **antes** do merge (aditiva); [R0]
  verificar em Prod. O arquivo de env com `DATABASE_URL` é mantido pelo humano; agente nunca o
  lê/imprime. Rollback: [R2] migração inversa por PR ou restaurar do branch de backup /
  point-in-time (`neonctl branches restore`).

- [ ] **Step 4: `segredos-e-env.md`** (Dev, UAT, Prod). Passos: [R0] listar nomes
  (`vercel env ls <amb>`); [R1] env não-secreta em Dev/UAT (`vercel env add NOME preview`)
  (Prod → [R2]); [R2] criar/rotacionar segredo: instruir o humano a rodar
  `! vercel env add NOME <amb>` e digitar o valor (agente não vê); para rotação, gerar a nova
  credencial no provedor (Auth0/Neon) pelo humano; [R2] remover o valor antigo
  (`vercel env rm NOME <amb>`); [R1] redeploy UAT / [R2] redeploy Prod; [R0] verificar presença
  do nome e saúde (smoke test). Regras: nunca `vercel env pull` para stdout, nunca `echo`
  de segredo, nunca em commit/PR. Rollback: [R2] restaurar credencial anterior (se ainda
  válida) + redeploy.

- [ ] **Step 5: `mcp-habilitar-e-conectar.md`** (UAT, Prod). Referenciar `docs/guides/mcp-guide.md`.
  Passos: [R2] Auth0: criar API com identifier = `MCP_RESOURCE_URL` exata do ambiente,
  permissions `<ctx>:read|write`, Enable RBAC + Add Permissions in the Access Token, roles para
  usuários de teste (humano no dashboard ou agente com Auth0 CLI após aprovação); [R2] DCR
  (UAT: aprovação; Prod: aprovação + justificativa; consentimento obrigatório — desligá-lo é
  R3); [R2] conexões de domínio + resource→audience; [R1] envs `AUTH0_ISSUER_BASE_URL`/
  `MCP_RESOURCE_URL` no UAT (Prod [R2]); [R1] redeploy UAT; [R0] verificar
  `curl -s https://<alias>/.well-known/oauth-protected-resource` (resource = MCP_RESOURCE_URL,
  authorization_servers = tenant do ambiente) e `curl -si -X POST https://<alias>/api/mcp` → 401
  com `WWW-Authenticate`; [R2] ligar escrita (`MCP_<CTX>_WRITE=on`) via `feature-flags.md`;
  [R3] Humano: conectar o ChatGPT (OAuth, login com usuário de teste) — o agente não faz login
  por ninguém; [R0] checar isolamento com dois usuários. Rollback: [R2] desligar escrita /
  remover envs MCP; [R2] desligar DCR.

- [ ] **Step 6: Run full root suite + CLI**

Run: `npm test > /tmp/rb4.log 2>&1; tail -8 /tmp/rb4.log; npm run check:runbooks; npm run check:runbooks -- --strict | tail -3; echo exit=$?`
Expected: testes PASS; `check-runbooks: ok`; estrito lista placeholders (exit do node 1).

- [ ] **Step 7: Commit**

```bash
git add docs/runbooks tests/unit/checkRunbooks.test.ts
git commit -m "docs(runbooks): bootstrap, migração, segredos e MCP"
```

---

### Task 5: Skill `runbook-execution` + slash-commands

**Files:**
- Create: `.claude/skills/runbook-execution/SKILL.md`
- Modify: `.claude/commands/deploy-staging.md`, `.claude/commands/deploy-prod.md`

- [ ] **Step 1: SKILL.md** — frontmatter `name: runbook-execution`, `description:` "Use ao
  executar qualquer operação de deploy/configuração (Vercel, Neon, Auth0, flags, segredos,
  MCP, rollback) — executa um runbook de docs/runbooks/ respeitando as classes de risco do
  ADR-013." Corpo (checklist, uma tarefa por item):
  1. Localizar o runbook (tabela do README); sem runbook → não executa, propõe via PR.
  2. Rodar `npm run check:runbooks`; checar `<preencher` no arquivo (bloqueia) e frescor
     (> 90 dias → avisa + eleva).
  3. Anunciar plano: ambiente, passos com classe efetiva (elevação aplicada).
  4. Pre-flight (R0) — divergência para.
  5. Loop por passo: R0 executa; R1 executa (Prod → R2); R2 bloco de aprovação (spec 5.2,
     com modelo do bloco); R3 entrega instrução ao humano e espera "feito"; depois
     `Verificar:` e comparar.
  6. Falha → Rollback com os mesmos gates.
  7. Registro (modelo do comentário, sem segredos).
  - Tabela "Red flags" (ex.: "o humano já aprovou antes" → aprovação é por operação; "é só
    um `echo $SECRET` para conferir" → R3; "o runbook não cobre, mas sei o comando" → desvio,
    para).

- [ ] **Step 2: `deploy-staging.md`** — substituir os passos por: "Use a skill
  `runbook-execution` com `docs/runbooks/deploy-uat.md`", mantendo o frontmatter e as notas
  de ADR-002/005; lembrar "NÃO faz merge".

- [ ] **Step 3: `deploy-prod.md`** — idem com `docs/runbooks/deploy-prod.md`; explicitar que
  o **merge é do humano** (`[R3]`), o agente prepara, confirma checks/UAT, acompanha o deploy
  e faz o smoke test; em problema, `rollback.md`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/runbook-execution .claude/commands/deploy-staging.md .claude/commands/deploy-prod.md
git commit -m "feat(skills): runbook-execution e commands de deploy via runbook"
```

---

### Task 6: Integração CLAUDE.md, SKILLS.md, deploy-ci-guide, README

**Files:** Modify `CLAUDE.md`, `SKILLS.md`, `docs/guides/deploy-ci-guide.md`, `README.md` (se
listar a árvore de `docs/`).

- [ ] **Step 1: CLAUDE.md** — nova seção `### 10. **Operação só via runbook** ⚠️` com o texto
  da spec 5.7 + resumo R0–R3 em 4 linhas + link ADR-013; na árvore, `docs/runbooks/` e
  `.claude/skills/` com `runbook-execution`; no início ("Ao iniciar um projeto real") ou
  numa seção "Adoção" curta: checklist 5.7 (preencher runbooks, `--strict` no CI).
  Atualizar regra 9 para citar `deploy-uat.md`/`deploy-prod.md`.
- [ ] **Step 2: SKILLS.md** — fase "### Operação — Deploy e Configuração" com
  `runbook-execution` (Projeto) e nota sobre ADR-013.
- [ ] **Step 3: deploy-ci-guide.md** — seção "Operação por agentes" apontando ADR-013 e
  `docs/runbooks/`; última seção: rollback e gatilhos agora vivem nos runbooks (o ADR do
  projeto registra host/checks; o *como* é runbook).
- [ ] **Step 4: README.md** — incluir `docs/runbooks/` na árvore, se houver.
- [ ] **Step 5: Verificação completa**

Run: `npm run lint > /tmp/rb6.log 2>&1 && npm run type-check >> /tmp/rb6.log 2>&1 && npm test >> /tmp/rb6.log 2>&1 && npm run check:runbooks >> /tmp/rb6.log 2>&1; echo exit=$?; tail -8 /tmp/rb6.log`
Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md SKILLS.md docs/guides/deploy-ci-guide.md README.md
git commit -m "docs: regra 10 (operação via runbook) e integração com skills e guias"
```
