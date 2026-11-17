# init-project e architecture-review — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catálogo de stack (`stack.catalog.json`) validado à mão, e duas skills: `architecture-review`, que acha ou gera o ADR de stack do projeto, e `init-project`, que escolhe a arquitetura-meta só do catálogo e roda os runbooks de setup ou migração.

**Architecture:** O catálogo JSON na raiz é lido por `scripts/stack/catalog.mjs`, com validação à mão no mesmo padrão de `scripts/deploy/config.mjs`. As skills são markdown que leem esse catálogo, e as duas são testadas por conteúdo. As mutações são feitas só via `runbook-execution`. Tudo vai para `managed` no template-sync.

**Tech Stack:** Node ESM (`.mjs`), Vitest, Markdown.

**Spec:** `docs/superpowers/specs/2026-11-16-init-e-architecture-review-design.md`

## Global Constraints

- Todo o conteúdo (skills, ADR, mensagens de erro) é em pt-BR. Commits seguem `tipo(escopo): mensagem` e terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Zod não entra no tooling da raiz (ADR-007). A validação é à mão e o erro lança `Error` com mensagem começando por `Catálogo de stack inválido:`.
- As 9 dimensões ficam nesta ordem: `perfil`, `formato`, `host`, `banco`, `auth`, `mcp`, `video`, `specGate`, `e2e`. As opções e os caminhos são exatamente os da tabela do §5.1 da spec.
- Opções recomendadas: `formato=next-monolito`, `host=vercel`, `banco=neon`, `auth=auth0`, `mcp=ligado`, `video=nenhum`, `specGate=off`, `e2e=playwright`. `perfil` não tem recomendada.
- Campos de `grava`:
  - `perfil` → `{ "arquivo": "CLAUDE.md", "campo": "Perfil arquitetural" }`
  - `host` → `{ "arquivo": "deploy.config.json", "campo": "host" }`
  - `video` → `{ "gh-variable": "DEMOS_BUNNY" }`
  - `specGate` → `{ "gh-variable": "SPEC_GATE" }`
  - todas as outras dimensões → `"nenhum"`
- Os ADRs de cada opção:
  - `perfil` → `docs/adr/template/011-service-layer-ddd-modular-e-perfis.md`
  - `formato` → `ARCHITECTURE.md`
  - `host` → `018-camada-de-deploy.md`
  - `banco` → `001-neon-auth0.md`, e cita o 003 nos prós
  - `auth` → `001-neon-auth0.md`, e cita o 004 nos prós
  - `mcp` → `012-mcp-como-borda-agentica.md`
  - `video` → `017-bunny-videos-demos-treinamento.md`
  - `specGate` → `014-release-management.md`
  - `e2e` → `016-testes-e2e-nascidos-da-spec.md`
- As skills nunca rodam comando mutante fora de runbook. Push e PR seguem as regras 0, 5 e 8. O merge é sempre do humano.
- O ADR de stack é do **projeto**: fica em `docs/adr/NNN-stack-tecnologica.md`, fora de `docs/adr/template/`, e o sync nunca toca nele.
- Não editar nem commitar os arquivos ` (1)` não rastreados que existem no repositório.

## Review Focus

1. **Catálogo com `setup`/`migracao` apontando para runbook renomeado.** O teste precisa falhar e citar o caminho (CA-1). O teste está na Task 1.
2. **Host novo em `HOSTS` sem entrada no catálogo, ou o contrário.** O teste compara os dois conjuntos. Está na Task 1.
3. **`parseCatalog` recebendo JSON malformado, `dimensoes` vazio ou ausente, ou uma opção sem `pros`.** Deve lançar `Catálogo de stack inválido:` em vez de `TypeError`. Os testes estão na Task 1.
4. **Projeto com dois ADRs de stack, um `Substituído` e outro `Aceito`.** A review tem que escolher o de maior NNN entre os `Aceito`. Na Task 2, o teste de conteúdo exige a regra textual.
5. **Dimensão escolhida sem `migracao`.** A skill avisa e mantém o valor atual, sem improvisar comando. Na Task 3, o teste exige "migração não suportada".

---

### Task 1: Catálogo e leitor validado

**Files:**

- Create: `stack.catalog.json`
- Create: `scripts/stack/catalog.mjs`
- Test: `tests/unit/stackCatalog.test.ts`
- Modify: `template-sync.manifest.json` (em `managed`: `stack.catalog.json` e `tests/unit/stackCatalog.test.ts`; `scripts/**` já está coberto)

**Interfaces:**

- Produces:
  - `CATALOG_PATH = 'stack.catalog.json'`.
  - `parseCatalog(texto: string): Catalog`, que lança `Error('Catálogo de stack inválido: <motivo>')`.
  - `lerCatalog(raiz = process.cwd()): Catalog`.
  - `Catalog = { versao: 1, dimensoes: Dimensao[] }`.
  - `Dimensao = { id, nome, grava, opcoes: Opcao[] }`.
  - `Opcao = { id, nome, recomendada: boolean, porque, pros: string[], contras: string[], adr, setup: string|null, migracao: string|null, codigoDoApp: Record<'next-monolito'|'expo-api', string[]> }`. `codigoDoApp` pode ser `{}`.

- [ ] **Step 1: Escrever os testes que falham** (no estilo de `deployConfig.test.ts`)

  ```ts
  import { HOSTS } from '../../scripts/deploy/config.mjs'
  import { lerCatalog, parseCatalog } from '../../scripts/stack/catalog.mjs'
  const catalog = lerCatalog()
  const DIMENSOES = [
    'perfil',
    'formato',
    'host',
    'banco',
    'auth',
    'mcp',
    'video',
    'specGate',
    'e2e',
  ]
  ```

  Testes:
  - `'tem as 9 dimensões na ordem'`: `catalog.dimensoes.map(d => d.id)` igual a `DIMENSOES`.
  - `'todo adr, setup e migracao existe'`: para cada caminho não nulo, `existsSync(resolve(p))`. A mensagem de falha inclui o caminho: `expect(existsSync(p), p).toBe(true)`.
  - `'no máximo uma recomendada por dimensão; perfil sem recomendada'`.
  - `'recomendação base vercel + neon + auth0'`: a recomendada de `host`, `banco` e `auth` é `vercel`, `neon` e `auth0`, nessa ordem.
  - `'recomendadas de formato, mcp, video, specGate, e2e'`: `next-monolito`, `ligado`, `nenhum`, `off`, `playwright`.
  - `'toda opção tem pros e contras (contras vazio só em dimensão de opção única)'`.
  - `'hosts do catálogo = HOSTS'`: os ids de `host`, ordenados, são iguais a `[...HOSTS].sort()`.
  - `'ids únicos por dimensão'`.
  - `'grava de perfil, host, video e specGate'`: os valores exatos das Global Constraints.
  - `'heroku em expo-api lista código do app'`: `codigoDoApp['expo-api']` de heroku tem ao menos um item que casa com `/Procfile/`.
  - Os testes de `parseCatalog` esperam `toThrow(/Catálogo de stack inválido/)` para: `'{'`, `'{"versao":1}'`, `'{"versao":1,"dimensoes":[]}'`, uma dimensão com uma opção sem `pros`, `recomendada` não booleana, `migracao: 1` e `versao: 2`.

- [ ] **Step 2: Rodar e ver falhar.** Rodar `npx vitest run tests/unit/stackCatalog.test.ts`. A falha esperada é de import, porque o módulo ainda não existe.

- [ ] **Step 3: Implementar `scripts/stack/catalog.mjs`**
  - A validação segue o estilo de `scripts/deploy/config.mjs`: `JSON.parse` dentro de try, e checagem de tipos campo a campo.
  - O teste valida a existência de caminhos e a semântica (recomendadas, `HOSTS`). O módulo só valida a forma.

- [ ] **Step 4: Escrever `stack.catalog.json`**
  - As 9 dimensões seguem a tabela do §5.1. `setup` de `host` é `docs/runbooks/host-<id>.md`, e `migracao` é `docs/runbooks/migrar-host.md`.
  - Em `mcp`, `video` e `specGate`, `migracao` aponta para o mesmo runbook de `setup`. Em `video=nenhum`, `setup` é `null` e `migracao` é `docs/runbooks/bunny-habilitar.md`, que é o caminho de desligar.
  - Nas dimensões `perfil`, `formato`, `banco`, `auth` e `e2e`, `migracao` é `null`.
  - `porque`, `pros` e `contras` são redigidos a partir dos ADRs citados.
  - `host`, prós e contras resumidos do ADR-018:
    - `vercel`: preview nativo, mas bloqueada na empresa do humano.
    - `heroku`: review apps e conta pessoal, mas sem plano grátis e com review apps pagos.
    - `cloudrun`: tag sem tráfego por PR e escala a zero, mas setup de WIF/AR mais longo.
  - `codigoDoApp`, sempre em texto:
    - `heroku` → `expo-api`: `Procfile` e build apontando para `apps/api`, servidor Node contínuo (`@hono/node-server`) em vez de funções.
    - `cloudrun` → `expo-api`: Dockerfile de `apps/api`.
    - `next-monolito` → `templates/heroku` e `templates/cloudrun` de `scripts/deploy/templates/`.

- [ ] **Step 5: Atualizar o manifesto.** Rodar `npx vitest run tests/unit/stackCatalog.test.ts tests/unit/templateSyncManifest.test.ts`. O esperado é PASS.

- [ ] **Step 6: Commit** `feat(stack): catálogo de stack validado e testado`

### Task 2: Skill `architecture-review`

**Files:**

- Create: `.claude/skills/architecture-review/SKILL.md`
- Test: `tests/unit/stackSkills.test.ts`, com o bloco `describe('architecture-review')`
- Modify: `template-sync.manifest.json`, para incluir `tests/unit/stackSkills.test.ts`. `.claude/**` já está coberto.

**Interfaces:**

- Consumes: `stack.catalog.json` e `lerCatalog` da Task 1. A skill cita o arquivo e manda ler pelas dimensões.
- Produces:
  - O ADR `docs/adr/NNN-stack-tecnologica.md`, com a tabela `Dimensão | Escolha | ADR de detalhe | Desde` e a seção `## Fora do catálogo`.
  - A Task 3 consome o "retrato": um valor por dimensão, com evidência `arquivo:linha`.

- [ ] **Step 1: Testes que falham** (padrão de `templateSyncSkill.test.ts`: `readFileSync` e regex do frontmatter)
  - frontmatter: `/^name: architecture-review$/m` e `/^description: Use /m`.
  - `toMatch(/stack-tecnologica\.md/)`.
  - `toMatch(/Status: Aceito/)`.
  - `toMatch(/maior/)`, para a regra do vigente.
  - `toMatch(/stack\.catalog\.json/)`.
  - `toMatch(/Fora do catálogo/)`.
  - `toMatch(/Dimensão \| Escolha \| ADR de detalhe \| Desde/)`.
  - `toMatch(/deploy\.config\.json/)`.
  - `toMatch(/gh variable list/)`.
  - `toMatch(/arquivo:linha/)`.
  - `toMatch(/\bPR\b/)`.
  - `toMatch(/Substituído por/)`.
  - `not.toMatch(/gh pr merge/)`.

- [ ] **Step 2: Rodar e ver falhar.** Rodar `npx vitest run tests/unit/stackSkills.test.ts`. O esperado é ENOENT.

- [ ] **Step 3: Escrever o SKILL.md** a partir do §3.1 e do §5.3 da spec. Passos:
  1. Ler o catálogo.
  2. Achar o vigente: o de maior NNN com `*-stack-tecnologica.md` e `Status: Aceito`.
  3. Se achar, conferir contra o estado real (`deploy.config.json`, ausente = vercel; Perfil do `CLAUDE.md`; `gh variable list` para `DEMOS_BUNNY`/`SPEC_GATE`) e reportar divergências.
  4. Se não achar, inferir cada dimensão de `package.json`, da estrutura (`apps/mobile` + `apps/api` → `expo-api`) e dos ADRs do projeto, com evidência `arquivo:linha`. Tudo o que não está no catálogo vai para "Fora do catálogo".
  5. O humano confirma o retrato.
  6. Gerar o ADR (próximo NNN livre, formato de `docs/adr/000-template.md`, `Desde` = data do ADR) numa feature branch, e abrir o PR pelas regras 0, 5 e 8.
  7. Quando chamada pela `init-project`, devolver o retrato sem abrir PR próprio.

- [ ] **Step 4: Rodar e ver passar.** Rodar `npx vitest run tests/unit/stackSkills.test.ts tests/unit/templateSyncManifest.test.ts`. O esperado é PASS.

- [ ] **Step 5: Commit** `feat(skills): architecture-review acha ou gera o adr de stack`

### Task 3: Skill `init-project`

**Files:**

- Create: `.claude/skills/init-project/SKILL.md`
- Test: `tests/unit/stackSkills.test.ts`, com o bloco `describe('init-project')`

**Interfaces:**

- Consumes: o retrato da `architecture-review`, da Task 2, e os campos do catálogo da Task 1 (`grava`, `setup`, `migracao`, `codigoDoApp`, `recomendada`, `pros`, `contras`, `porque`).

- [ ] **Step 1: Testes que falham**
  - frontmatter: `/^name: init-project$/m` e `/^description: Use /m`.
  - `toMatch(/architecture-review/)`.
  - `toMatch(/runbook-execution/)`.
  - `toMatch(/stack\.catalog\.json/)`.
  - `toMatch(/só o catálogo/i)`.
  - `toMatch(/migração não suportada/i)`.
  - `toMatch(/projeto novo/i)`.
  - `toMatch(/bootstrap-ambientes\.md/)`.
  - `toMatch(/codigoDoApp/)`.
  - `toMatch(/Substituído por/)`.
  - `toMatch(/ADR-011/)`, porque a promoção de perfil não é feita aqui.
  - `not.toMatch(/gh pr merge/)`.

- [ ] **Step 2: Rodar e ver falhar.** O esperado é ENOENT no bloco novo.

- [ ] **Step 3: Escrever o SKILL.md** a partir do §3.2 da spec.
  1. Invocar a `architecture-review` para obter o retrato.
  2. Detectar se é projeto novo: sem ADR de stack, sem `deploy.config.json` e sem código de app.
  3. Para cada dimensão:
     - mostrar opções, prós, contras e recomendação;
     - a dimensão de opção única é só informada;
     - um pedido fora do catálogo é recusado ("só o catálogo": primeiro adicione ao template).
  4. Mostrar o resumo atual → meta → runbook, com os itens de `codigoDoApp` do formato.
  5. Abrir um PR com:
     - o ADR novo (o anterior passa a `Substituído por [NNN]`);
     - `deploy.config.json`;
     - o Perfil no `CLAUDE.md`, só em projeto novo;
     - as gh-variables via runbook.
  6. Projeto novo: rodar os `setup` via `runbook-execution`, `bootstrap-ambientes.md` primeiro e os compartilhados uma vez só.
  7. Projeto existente: rodar só as dimensões alteradas, pela `migracao`. Se `migracao` for null, é "migração não suportada": avisar e manter o valor atual. O perfil não muda aqui (promoção pelo ADR-011).

- [ ] **Step 4: Rodar e ver passar.** Rodar `npx vitest run tests/unit/stackSkills.test.ts`. O esperado é PASS.

- [ ] **Step 5: Commit** `feat(skills): init-project escolhe a stack do catálogo e roda runbooks`

### Task 4: ADR-019 e documentação

**Files:**

- Create: `docs/adr/template/019-stack-por-catalogo.md`
- Modify:
  - `SKILLS.md`: nova subseção `### Stack — Arquitetura do projeto` antes de `### Design — Autoria de Spec`, com as duas skills na tabela.
  - `CLAUDE.md:38`: nota curta depois de "Adoção — host": `> **Adoção — stack** ([ADR-019](...)): rode `/init-project` para escolher perfil, host e gates pelo catálogo (`stack.catalog.json`); ele registra a stack num ADR do projeto.`
  - `docs/adr/README.md`, se houver índice. Conferir com `ls docs/adr`.
- Test: suíte existente (`docsLinks`, `templateSyncManifest`).

- [ ] **Step 1: Escrever o ADR-019** no formato do ADR-018 (`**Data**: 2026-11-17`, `**Status**: Aceito`). Conteúdo:
  - Contexto: 4 projetos e o bloqueio da Vercel.
  - Decisão: catálogo como fonte, regra "só o catálogo", ADR de stack por projeto (vigente e substituição), recomendação atual vercel + neon + auth0, e roadmap Supabase/Firebase.
  - Consequências.
  - Alternativas: abordagens B e C do §4 da spec.
  - Os links são relativos e não apontam para `docs/superpowers/` (o teste de docsLinks do sync quebra).
- [ ] **Step 2: Editar SKILLS.md e CLAUDE.md.**
- [ ] **Step 3: Rodar** `npm test`. O esperado é toda a suíte verde.
- [ ] **Step 4: Commit** `docs(adr): adr-019 stack por catálogo e notas de adoção`

### Task 5: Verificação final

- [ ] Rodar `npm run lint && npm run type-check && npm test && npm run check:runbooks && npm run format -- --check`. Tudo precisa sair verde (CA-7).
- [ ] Fazer a conferência spec × código: CA-1 a CA-7 ok, CA-8 `parcial` (uso real no AssistBru depois do merge).
