---
name: template-sync
description: Use para manter um projeto derivado em dia com o template (sync a cada Release, adoção do primeiro sync), levar melhorias de um projeto de volta ao template (contribuir) ou ver como cada projeto está em relação ao template (status) — tudo termina em PR, ver ADR-015.
---

# Template Sync

## Visão Geral

O template evolui; os projetos criados a partir dele **puxam** as novidades por PR, sem
perder o que o projeto mudou e sem perguntar de novo o que já foi decidido. Decisão e regras em
[ADR-015](../../../docs/adr/template/015-template-sync.md).

- **Motor determinístico** (`scripts/template-sync.mjs`): classifica, aplica os casos limpos,
  junta com `git merge-file` e devolve JSON. **Você** julga: resolve conflitos, generaliza,
  pergunta.
- **Três vias**: base = template no `lastSync` do `.template-sync.json`; alvo = Release mais
  nova; projeto = HEAD. O que já foi decidido num sync não volta.
- **Do template** = o que casa com `template-sync.manifest.json`. Fora dele, nada é tocado
  (exceção: links para ADRs do template que mudaram de lugar, listados no PR).
- Tudo termina em **PR** (regra 0 do `CLAUDE.md`). Você **nunca** roda `gh pr merge` e nunca
  marca o UAT.

| Modo         | Onde roda          | Chamada                                        |
| ------------ | ------------------ | ---------------------------------------------- |
| `sync`       | sessão do projeto  | `/template-sync`                               |
| `adotar`     | sessão do template | `/template-sync adotar <caminho do projeto>`   |
| `contribuir` | sessão do projeto  | `/template-sync contribuir <arquivo\|assunto>` |
| `status`     | sessão do template | `/template-sync status`                        |

Nos comandos abaixo, `<clone>` é o clone temporário do template, `<projeto>` o caminho absoluto
do projeto e `<tmp>` um diretório temporário **fora** do projeto (o plano e os relatórios não
podem sujar a árvore). Escreva caminhos literais nos comandos `git`/`gh`, sem variáveis de
shell.

## Modo `sync`

Checklist (crie uma tarefa por item):

1. **Árvore limpa**: `git status --porcelain` vazio. Suja → pare e peça commit ou stash.
2. **Conta `gh`** (regra 5): `gh auth status --active`; se não for a conta do repo do projeto,
   troque antes do push.
3. **Branch**: `git switch -c chore/template-sync-<vY>` a partir da `main` atualizada (`<vY>` é
   a Release alvo, do passo 5).
4. **Clone do template**: `git clone <template do .template-sync.json> <clone>`.
5. **Release alvo**: `node <clone>/scripts/template-sync.mjs latest --template <clone>` →
   `{ tag, commit }`. `null` → o template não tem Release; pare e avise. `lastSync.version`
   igual à tag → "em dia", pare.
6. **Checkout da Release**: `git -C <clone> checkout <tag>`. Daqui em diante rode o motor
   **do clone** (`node <clone>/scripts/template-sync.mjs …`) e siga esta skill **do clone**
   (`<clone>/.claude/skills/template-sync/SKILL.md`), não a cópia do projeto, que pode ser
   antiga.
7. **Plano**: `node <clone>/scripts/template-sync.mjs plan --template <clone> --project <projeto> --target <tag> > <tmp>/plan.json`.
8. **Resumo ao humano**: quantos `write`/`delete`/`move`/`merge`/`ask`, e os `owned`.
9. **Aplicar**: `node <clone>/scripts/template-sync.mjs apply --template <clone> --project <projeto> --plan <tmp>/plan.json > <tmp>/report.json`.
   O relatório traz `applied`, `merged`, `conflicts`, `asked`, `notes`, `linkRewrites`.
10. **Resolver `conflicts`** arquivo a arquivo (marcadores `<<<<<<< projeto` / `>>>>>>> template`):
    - preserve a **intenção do projeto**; traga só a novidade do template;
    - runbooks: os valores preenchidos do projeto prevalecem; só a estrutura nova entra;
    - JSON precisa parsear (`node -e "JSON.parse(require('fs').readFileSync('<arquivo>','utf8'))"`);
    - anote o porquê de cada decisão para o PR.
11. **Perguntar os `asked`** numa **única** mensagem (arquivo, caso, o que você recomenda). Só
    o que o humano decidir é aplicado.
12. **`notes`** (itens que só existem por causa de `examples/`, como o check
    `Walking Skeleton (example)` em `requiredChecks`): **aponte** no PR; nunca remova sozinho.
13. **Dependências**: `package.json` mudou → `npm install` (regera o `package-lock.json`).
14. **Verificar**: `npm run lint`, `npm run type-check`, `npm test`, `npm run check:runbooks`.
    Falhou → corrija no próprio PR ou explique no corpo; não esconda.
15. **Registrar o sync**: `node <clone>/scripts/template-sync.mjs finish --project <projeto> --template <clone> --target <tag>`
    (grava `lastSync` no `.template-sync.json`).
16. **Commit**: `chore(template): sync vX → vY` (`vX` = `lastSync.version` anterior; `null` →
    "base anterior às Releases").
17. **Push + PR** com o template de PR (`.github/pull_request_template.md`), UAT
    **desmarcado**, título `chore(template): sync vX → vY` e no corpo as seções:
    **Aplicados** · **Juntados** (com o porquê de cada conflito resolvido) · **Perguntados**
    (com a decisão do humano) · **Links reescritos** · **Notas** · **Candidatos a voltar ao
    template** (melhorias do projeto que parecem genéricas — sugira `/template-sync contribuir`).
18. **Restaurar** a conta `gh` padrão da máquina e apagar `<clone>` e `<tmp>`. Avise o humano
    que o PR está pronto e o UAT pendente.

## Modo `adotar`

Primeiro sync de um projeto sem `.template-sync.json` (ele ainda não tem esta skill), rodado na
sessão do template:

1. **Aprovação explícita** do humano antes de escrever no projeto (branch, arquivos, push).
2. **Árvore limpa** no projeto e **conta `gh`** (como no `sync`, passos 1–2).
3. **Base**: `node scripts/template-sync.mjs propose-base --template . --project <projeto>` →
   até 3 commits do template com mais arquivos idênticos. Mostre-os; o humano confirma um ou
   escolhe **sem base** (projeto que é origem do template: `--base none`, todo arquivo que
   difere vira "os dois mudaram" e é decidido um a um).
4. **Release alvo** e clone: `node scripts/template-sync.mjs latest --template .`; trabalhe
   num clone do template no checkout da tag (como no `sync`, passos 4–6).
5. **Plano** com a base escolhida:
   `node <clone>/scripts/template-sync.mjs plan --template <clone> --project <projeto> --target <tag> --base <sha|none> > <tmp>/plan.json`;
   depois siga o `sync` dos passos 8 a 14.
6. **ADRs copiados**: um ADR do projeto em `docs/adr/NNN-*.md` que seja cópia de um ADR do
   template (mesmo título, conteúdo quase igual) → **proponha** a remoção em favor de
   `docs/adr/template/`. Aprovado: apague a cópia e reescreva os links,
   `node <clone>/scripts/template-sync.mjs rewrite-links --project <projeto> --map docs/adr/<velho>.md=docs/adr/template/<novo>.md`
   (um `--map` por ADR). Os demais ADRs do projeto ficam, com a numeração dele.
7. **Registrar**: `node <clone>/scripts/template-sync.mjs finish --project <projeto> --template <clone> --target <tag> --template-url <URL do repo do template>`.
8. **Commit, push + PR** como no `sync` (passos 16–18), com título
   `chore(template): adota o template vY`. O PR instala a skill, o workflow de aviso
   (`template-sync-check.yml`) e o `.template-sync.json`.

## Modo `contribuir`

Leva uma melhoria do projeto para o template:

1. **Generalizar**: tire nome do projeto, contas, repos, domínios, segredos, valores de runbook
   preenchidos e regras de negócio do projeto. O template é agnóstico.
2. **Clone do template** (URL do `.template-sync.json`) e branch `feat/<assunto>` ou
   `docs/<assunto>`. Nunca push na `main`.
3. **Aplicar** a versão generalizada no clone, seguindo `ARCHITECTURE.md`/`BEST_PRACTICES.md`
   do template (ADR novo do template → `docs/adr/template/NNN-*.md`).
4. **Checar agnóstico**, com os termos do projeto — nome do projeto, owner do remote
   (`git remote get-url origin`) e as contas de `gh auth status`:
   `node <clone>/scripts/template-sync.mjs check-agnostic --root <clone> --term <nome> --term <owner> --term <conta> --files <arq1> --files <arq2>`
   (um `--files` por arquivo alterado). Termo encontrado → generalize e rode de novo.
5. **Verificar** no clone: `npm install`, `npm run lint`, `npm run type-check`, `npm test`,
   `npm run check:runbooks`.
6. **Conta `gh`** (regra 5), **push + PR no template** com o template de PR e a conferência
   spec × código; UAT desmarcado. Restaure a conta padrão. A Release seguinte leva a melhoria
   aos demais projetos.

## Modo `status`

Visão dos projetos em relação ao template, na sessão do template:

1. **Lista local**: leia `~/.config/template-sync/projects.json`
   (`{ "projects": [{ "path": "/caminho/absoluto" }] }`). Ausente → mostre esse formato ao
   humano e pare. A lista **nunca** vira arquivo versionado.
2. **Inventário** por projeto:
   `node scripts/template-sync.mjs inventory --template . --project <projeto>` →
   `{ project, lastSync, behind, divergent, own }`. Sem `.template-sync.json` →
   `node scripts/template-sync.mjs propose-base --template . --project <projeto>` para estimar
   a base e marque "não adotado".
3. **Repetições**: compare `own.adrTitles` e `own.files` entre projetos. A mesma melhoria em
   ≥ 2 projetos → candidata forte a `contribuir`. Se o template **já cobre** o assunto (ex.: um
   ADR próprio que repete um ADR do template), liste como "adotar a versão do template".
4. **Publicar** na issue do template com rótulo `template-status` (uma só, substituída a cada
   execução): `gh issue list --label template-status --state open` → existe →
   `gh issue edit <n> --body-file <tmp>/status.md`; não existe →
   `gh issue create --label template-status --title "Status dos projetos derivados" --body-file <tmp>/status.md`
   e `gh issue pin <n>`. Corpo: por projeto, versão, versões atrás, divergentes e não
   adotado; depois as repetições.

## Red Flags

| Pensamento                                             | Realidade                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| "Rodo o motor do próprio projeto, é mais rápido"       | A cópia do projeto pode ser antiga. Motor e skill vêm do clone na tag alvo.    |
| "O conflito é pequeno, fico com a versão do template"  | Preserve a intenção do projeto; traga só a novidade. Explique no PR.           |
| "O runbook do template é mais novo, sobrescrevo"       | Valores preenchidos do projeto prevalecem; só a estrutura nova entra.          |
| "Esse `ask` é óbvio, decido sozinho"                   | `ask` é do humano. Pergunte, numa mensagem só.                                 |
| "O check do exemplo não serve aqui, removo"            | Itens de `examples/` são apontados no PR, nunca removidos sozinhos.            |
| "Uso a `main` do template, tem coisa mais nova"        | O sync mira a Release mais nova, nunca um commit solto.                        |
| "Já que estou no projeto, ajusto `src/`"               | Fora do manifesto nada é tocado (só links de ADRs movidos).                    |
| "Contribuo como está, o nome do projeto não atrapalha" | O template é agnóstico. `check-agnostic` antes do PR.                          |
| "Salvo a lista de projetos no repo, fica mais fácil"   | A lista fica em `~/.config/template-sync/`; o relatório é uma issue.           |
| "PR verde, posso mergear"                              | Nunca `gh pr merge`: o merge é do humano (no projeto, merge = deploy em Prod). |
| "Árvore suja, mas é só um arquivo"                     | Árvore suja → o sync não começa.                                               |
