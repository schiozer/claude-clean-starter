# Spec: Skills `architecture-review` e `init-project` — stack por catálogo, registro em ADR

**Data**: 2026-11-16
**Status**: Aprovada (2026-11-17; sem cenários `CT-` — infraestrutura do template, ver §8)
**Autor(es)**: Fabio Schiozer + Claudinho

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano e a implementação.
> Marcado _(decisão do Claudinho)_ = escolha do agente que o humano pode revisar.

## 1. Contexto e Objetivo

As decisões de tecnologia de um projeto derivado estão espalhadas: notas de "Adoção" no `CLAUDE.md`
(perfil, contas, `SPEC_GATE`, `DEMOS_BUNNY`, E2E), `deploy.config.json` (host, ADR-018), variáveis
do GitHub e ADRs soltos de cada projeto (no AssistBru: 002 Neon, 003 Vercel serverless, 004 Auth0,
010 build da Vercel). Para saber "o que este projeto usa" é preciso procurar toda vez, e não há um
jeito guiado de mudar uma escolha.

**Objetivo**: duas skills do template, invocáveis a qualquer momento (projeto novo ou existente):

1. **`architecture-review`** — passo 1, o **retrato**: acha o ADR de stack do projeto e o lê; se não
   existir, levanta a stack (config, código, ADRs) e **gera** o ADR. Serve sozinha para "o que este
   projeto usa?".
2. **`init-project`** — chama a review e faz o passo 2, a **arquitetura meta**: para cada dimensão mostra as
   opções **do catálogo** com prós, contras e a recomendação; o humano escolhe; então
   - **projeto novo** → grava as escolhas e roda os **runbooks de setup**;
   - **projeto existente** → compara retrato × meta e roda o **runbook de migração** de cada
     dimensão que mudou.

**Só o que está no catálogo é oferecido.** Quem quiser outra tecnologia leva antes ao template o
ADR e o runbook dela (via `/template-sync contribuir` ou PR no template) e só então roda a `init-project`.

A recomendação de hoje é **Vercel + Neon + Auth0** (decisão do humano).

Primeiro uso real, logo depois desta entrega: migrar o **AssistBru.ai** da Vercel para o **Heroku**
pela `init-project`.

## 2. Não-Objetivos

- **Novas tecnologias no catálogo** (Supabase, Firebase…) — ver §10. Esta spec cataloga só o que o
  template já suporta.
- **Escrever o código do app** que uma migração exige (ex.: a API Hono do AssistBru, hoje funções da
  Vercel via esbuild, virar servidor Node contínuo no Heroku). A `init-project` **lista** esse trabalho como
  "código do app"; ele é feito no projeto, com a disciplina normal (spec/plano ou
  `systematic-debugging`).
- **Runbooks de migração novos** além do `migrar-host.md` (o `migracao-banco.md` existente é de
  migração de schema SQL, não de troca de provedor, e não entra no catálogo). Dimensão sem runbook de migração = não
  suportada para migrar (a skill avisa e para nela).
- Operar fora de runbook: tudo que muda infraestrutura passa pelo `runbook-execution` (regra 10,
  ADR-013). As skills novas não executam comando de host, banco ou auth por conta própria.

## 3. Fluxo de quem usa

### 3.1 `architecture-review`

1. Procura o ADR de stack **vigente** do projeto (§5.3).
2. **Achou** → lê a tabela e confere com o que é verificável na hora (R0, leitura): `host` do
   `deploy.config.json` (ou `vercel` se ausente), `Perfil arquitetural` do `CLAUDE.md`, variáveis
   `SPEC_GATE`/`DEMOS_BUNNY` (`gh variable list`). Divergência → aponta no relatório e sugere
   atualizar o ADR (não corrige sozinha).
3. **Não achou** → levanta a stack: os mesmos itens do passo 2, as dependências dos `package.json`
   (Neon, Auth0, Expo, Hono, Next.js, Playwright, MCP SDK, Bunny), a estrutura (`apps/mobile` +
   `apps/api` = formato nativo) e os ADRs do projeto. Para cada dimensão do catálogo propõe o valor
   e a evidência (arquivo:linha); o que não deu para inferir vira pergunta ao humano, uma de cada vez.
4. Itens **fora do catálogo** encontrados (ex.: Vercel Blob no PerformaRM) entram no relatório e no
   ADR numa seção "Fora do catálogo", sem dimensão.
5. Gera o ADR e entrega por **feature branch + PR** (regras 0, 5 e 8). Nunca commita na `main`.
6. Saída: o relatório (tabela dimensão → valor → evidência → ADR de detalhe) e, se gerou, o link do PR.

### 3.2 `init-project`

1. Roda a `architecture-review` (3.1). Projeto **novo** = sem ADR de stack, sem `deploy.config.json`
   e sem código de app além do template; nesse caso o retrato é vazio e não gera ADR ainda.
2. Para cada dimensão do catálogo (ordem do catálogo), mostra: valor atual (se houver), as opções
   com **prós e contras**, qual é a **recomendada** e por quê. O humano escolhe (pode manter a
   atual). Dimensão com uma opção só é mostrada como informação, sem pergunta.
3. Monta a **meta** e mostra o resumo: dimensão → atual → meta → runbook que vai rodar. Para o
   formato do app, lista também o **código do app** que a mudança exige (campo `codigoDoApp` do
   catálogo — ex.: `expo-api` + host `heroku` → `Procfile`/build apontando para `apps/api`).
4. Confirmação do humano. Então, **um PR** (projeto existente sem ADR de stack: o ADR gerado já
   registra a meta, e a seção Contexto guarda o retrato com os valores anteriores — um ADR só, sem
   ADR intermediário _(decisão do Claudinho)_) com: o novo ADR de stack (substituindo o anterior, §5.3),
   `deploy.config.json` e o `Perfil arquitetural` do `CLAUDE.md` quando mudam. Variáveis do GitHub
   (`SPEC_GATE`, `DEMOS_BUNNY`) **não** vão no PR — são passo de runbook.
5. **Novo** → chama o `runbook-execution` com os runbooks de setup das escolhas, na ordem do
   catálogo (o `bootstrap-ambientes.md` primeiro; ele já chama o bloco do host).
   Runbook repetido entre dimensões (ex.: `bootstrap-ambientes.md` de `banco`/`auth`) roda **uma
   vez**; ordem: `bootstrap-ambientes.md` (que chama o bloco do host), depois os demais na ordem do
   catálogo _(decisão do Claudinho)_.
   **Existente** → só as dimensões cujo valor **muda** importam: com `migracao` no catálogo →
   `runbook-execution` desse runbook (para ligar/desligar, os runbooks de `mcp`, `video` e
   `specGate` já têm o caminho de desligar — `spec-gate.md` passo de desligar, `bunny-habilitar.md`
   e `mcp-habilitar-e-conectar.md` no Rollback); sem → avisa "migração de `<dimensão>` não suportada
   pelo template" e mantém o valor atual. `perfil` em projeto existente não muda pela skill: a
   promoção é o processo do ADR-011, e a skill aponta para ele _(decisão do Claudinho)_.
6. As classes R0–R3 valem como sempre; o merge do PR é do humano (R3).

## 4. Abordagens consideradas

| Abordagem         | Como                                                                             | Prós                                                                                                                        | Contras                                                                      |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **A (escolhida)** | Catálogo em `stack.catalog.json` (dados) + ADR de stack do projeto como registro | Teste garante que toda opção tem ADR e runbook; recomendação muda sem mexer na skill; o registro é o ADR que o humano pediu | Um JSON e um teste a mais                                                    |
| B                 | Catálogo em tabela dentro do `SKILL.md`                                          | Zero código                                                                                                                 | Catálogo e runbooks saem de sincronia sem ninguém ver — fere "só o catálogo" |
| C                 | `stack.json` do projeto gera o ADR                                               | Mais automatizável                                                                                                          | Dois registros que divergem; o ADR vira artefato gerado                      |

Duas skills (review separada da `init-project`; nome `init-project` escolhido pelo humano para não colidir com o `/init` nativo do Claude Code) _(decisão do Claudinho)_: a review é útil sozinha e é o
passo 1 da `init-project`.

## 5. Desenho

### 5.1 `stack.catalog.json` (raiz do template, `managed` no template-sync)

```json
{
  "versao": 1,
  "dimensoes": [
    {
      "id": "host",
      "nome": "Host (deploy)",
      "grava": { "arquivo": "deploy.config.json", "campo": "host" },
      "opcoes": [
        {
          "id": "vercel",
          "nome": "Vercel",
          "recomendada": true,
          "porque": "…",
          "pros": ["…"],
          "contras": ["…"],
          "adr": "docs/adr/template/018-camada-de-deploy.md",
          "setup": "docs/runbooks/host-vercel.md",
          "migracao": "docs/runbooks/migrar-host.md",
          "codigoDoApp": { "expo-api": ["…"] }
        }
      ]
    }
  ]
}
```

- `grava`: onde a escolha é registrada além do ADR — `deploy.config.json`, `CLAUDE.md`
  (`Perfil arquitetural`), `gh-variable` (nome da variável, aplicado pelo runbook) ou `nenhum`.
- `setup`/`migracao`: caminho de runbook ou `null`. `migracao: null` = não migra.
- `codigoDoApp`: por formato de app, lista de itens que a escolha exige no código (só texto).

**Dimensões e opções** (prós/contras/porquê redigidos no catálogo a partir dos ADRs citados):

| Dimensão   | Opções (recomendada em negrito)                                         | ADR                                                                   | Setup                                         | Migração         | Grava                       |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------- | ---------------- | --------------------------- |
| `perfil`   | `mvp-primeiro`, `completo-direto` (sem recomendada: depende do projeto) | 011                                                                   | —                                             | —                | `CLAUDE.md`                 |
| `formato`  | **`next-monolito`**, `expo-api`                                         | ARCHITECTURE.md (seção nativo) _(decisão do Claudinho: sem ADR novo)_ | —                                             | —                | nenhum                      |
| `host`     | **`vercel`**, `heroku`, `cloudrun`                                      | 018                                                                   | `host-<host>.md` (caminho concreto por opção) | `migrar-host.md` | `deploy.config.json`        |
| `banco`    | **`neon`**                                                              | 001, 003                                                              | `bootstrap-ambientes.md`                      | —                | nenhum                      |
| `auth`     | **`auth0`**                                                             | 001, 004                                                              | `bootstrap-ambientes.md`                      | —                | nenhum                      |
| `mcp`      | **`ligado`**, `desligado`                                               | 012                                                                   | `mcp-habilitar-e-conectar.md`                 | o mesmo          | nenhum                      |
| `video`    | **`nenhum`**, `bunny`                                                   | 017                                                                   | `bunny-habilitar.md` (só `bunny`)             | o mesmo          | `gh-variable` `DEMOS_BUNNY` |
| `specGate` | **`off`**, `on`                                                         | 014                                                                   | `spec-gate.md`                                | o mesmo          | `gh-variable` `SPEC_GATE`   |
| `e2e`      | **`playwright`**                                                        | 016                                                                   | `e2e-uat-configurar.md`                       | —                | nenhum                      |

Recomendadas de `mcp`, `video`, `specGate` _(decisão do Claudinho)_: MCP ligado (ADR-012, o sistema
é agêntico), vídeo desligado e gate desligado (os dois nascem desligados no template).

### 5.2 Teste do catálogo (`tests/unit/stackCatalog.test.ts`, `managed`)

- JSON válido pela validação de `scripts/stack/catalog.mjs` (leitura + validação à mão, como o
  `scripts/deploy/config.mjs` — o tooling da raiz não tem Zod, ADR-007) _(decisão do Claudinho:
  as skills e o teste leem pelo mesmo módulo)_.
- Todo `adr`, `setup` e `migracao` não nulo aponta para arquivo que existe.
- Toda dimensão tem no máximo uma `recomendada`; `host`, `banco`, `auth` recomendam `vercel`,
  `neon`, `auth0`.
- Toda opção tem ao menos um item em `pros` e um em `contras` (exceto dimensões de opção única,
  que podem ter `contras` vazio).
- `host` do catálogo = hosts aceitos por `scripts/deploy/config.mjs` (nenhum host no catálogo sem
  adaptador, e vice-versa).
- IDs únicos por dimensão.

### 5.3 ADR de stack do projeto

- Arquivo do **projeto** (não do template): `docs/adr/NNN-stack-tecnologica.md`, `NNN` = próximo
  livre. Título `NNN. Stack tecnológica`. Formato do `000-template.md`.
- **Decisão** = tabela `Dimensão | Escolha | ADR de detalhe | Desde`, com os `id` do catálogo;
  seção extra **Fora do catálogo** (pode ser vazia). `ADR de detalhe` = o ADR do template do
  catálogo + os ADRs do projeto que a review achou como evidência (o humano confirma). `Desde` =
  data do ADR de stack em que o valor apareceu pela primeira vez; no primeiro ADR gerado, a data
  dele _(decisão do Claudinho: não garimpar git log)_.
- `formato` só é registrado no ADR (`grava: nenhum`), detectado pela estrutura (`apps/mobile` +
  `apps/api` → `expo-api`). `codigoDoApp` pode existir em qualquer opção; o texto é redigido no
  catálogo pelo construtor (ex.: `heroku` + `expo-api`: `Procfile` e build apontando para
  `apps/api`, servidor Node contínuo em vez de funções).
- **Vigente** = o de maior `NNN` com nome `*-stack-tecnologica.md` e `Status: Aceito`.
- Revisitar e mudar algo cria um ADR novo; o anterior passa a `Status: Substituído por [NNN]`
  (única edição permitida em ADR antigo). Sem mudança → nenhum ADR novo.
- O sync nunca toca (`docs/adr/NNN-*` é do projeto, ADR-015).

### 5.4 Skills

- `.claude/skills/architecture-review/SKILL.md` e `.claude/skills/init-project/SKILL.md`, frontmatter
  `name` + `description` começando por "Use" (padrão das skills do projeto), em pt-BR, `managed`.
- A `init-project` invoca a `architecture-review` e o `runbook-execution`; nenhuma das duas roda comando
  mutante fora de runbook. Push/PR seguem as regras 0, 5 e 8 (conta `gh` correta).
- `SKILLS.md`: as duas na fase **Design** (ou nova linha "Stack"), e a `init-project` citada nas notas de
  Adoção do `CLAUDE.md` como o caminho para preencher perfil/host/gates.
- Testes de conteúdo (`tests/unit/stackSkills.test.ts`), no estilo do `templateSyncSkill.test.ts`:
  frontmatter; a review cita o ADR `*-stack-tecnologica.md` e gera por PR; a `init-project` cita
  `stack.catalog.json`, "só o catálogo", `runbook-execution`, e o caso "migração não suportada".

### 5.5 Template-sync

`stack.catalog.json`, `scripts/stack/**`, as duas skills e os testes novos em `managed` (conferir
globs existentes). O ADR de stack é do projeto.

## 6. Documentação

- ADR do template **019 — Stack por catálogo e registro em ADR**: catálogo como fonte das opções,
  regra "só o catálogo", ADR de stack por projeto, recomendação atual.
- `CLAUDE.md`: nota de adoção curta apontando para `/init-project`. `SKILLS.md`: as duas skills.

## 7. Requisitos não funcionais

Segue o baseline (não há tela nem rota).

## 8. Cenários de teste

Infraestrutura do template (skills + catálogo), sem tela nem rota: sem cenários `CT-`. Cobertura
por Vitest (§5.2, §5.4).

## 9. Critérios de Aceitação

- **CA-1**: `stack.catalog.json` com as 9 dimensões do §5.1; `stackCatalog.test.ts` passa e falha se
  uma opção apontar para runbook/ADR inexistente.
- **CA-2**: recomendação `vercel` + `neon` + `auth0` no catálogo, com prós/contras em toda opção.
- **CA-3**: `architecture-review` acha o ADR vigente, ou gera um por PR, com evidência por dimensão
  e seção "Fora do catálogo".
- **CA-4**: `init-project` em projeto novo grava as escolhas por PR e chama os runbooks de setup.
- **CA-5**: `init-project` em projeto existente gera ADR substituto, roda o runbook de migração das
  dimensões alteradas e recusa as que não têm migração.
- **CA-6**: ADR-019, `SKILLS.md`, `CLAUDE.md` e manifesto atualizados.
- **CA-7**: `npm run lint`, `npm run type-check`, `npm test`, `npm run check:runbooks` verdes.
- **CA-8**: uso real — `architecture-review` + `init-project` no **AssistBru.ai** (após `/template-sync`
  para a versão com esta entrega), host `vercel` → `heroku`, até o PR de migração aberto e o
  runbook `migrar-host.md` iniciado. Feito depois do merge; até lá `parcial` na conferência.

## 10. Itens Futuros (roadmap)

- **Supabase** como banco e como auth. Muda a autorização: RLS passa a ser natural (a ARCHITECTURE
  já cita o Supabase) e exige `IAccessTokenVerifier`/sessão próprios. O PerformaRM já fez o caminho
  inverso (ADR-004 dele: Supabase → Neon + Auth0) — base para prós/contras e para o runbook.
- **Firebase** como banco: decidir antes **Firestore** (documental — quebra migrações SQL do
  ADR-008, rate limit do ADR-010 e repositórios relacionais; sem migração de/para Postgres) ou
  **Firebase Data Connect** (Postgres via Cloud SQL — entra quase como mais um Postgres).
- Runbooks de migração de banco e auth (hoje só o host migra).
- Armazenamento plugável (Vercel Blob → Cloud Storage/S3) para o PerformaRM.
- Hosts adicionais (Cloudflare Workers, AWS Amplify, Azure).
