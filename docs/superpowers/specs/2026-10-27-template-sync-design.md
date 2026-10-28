# Spec: Template sync — manter projetos derivados em dia com o template (e vice-versa)

**Data**: 2026-10-27
**Status**: Em revisão
**Autor(es)**: Fabio Schiozer + Claudinho

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano e a
> implementação. Vira o **ADR-015** (template sync).

## 1. Contexto e Objetivo

O template evolui (proteção da `main`, runbooks, gates, release management…), mas os projetos
criados a partir dele **nunca recebem** essas melhorias: trazer à mão dá trabalho e medo de
sobrescrever o que o projeto mudou. Um levantamento em 2026-10-27 nos 4 projetos do humano
mostrou:

- Cada projeto está num ponto diferente: um saiu do template há duas semanas (2 arquivos
  divergentes), outro do primeiro commit do template (11 divergentes), e um é a **origem** do
  template — o template nasceu dele e evoluiu, e ele nunca recebeu a evolução.
- Arquivos "do template" (`ci.yml`, `package.json`, `eslint.config.mjs`, `CLAUDE.md`) foram
  mudados em **todos** os projetos: "os dois lados mudaram" é a regra, não a exceção.
- **Colisão de números de ADR**: o ADR-014 do template é release management; nos projetos o
  014 é "perfil completo-direto" ou "vídeo com Bunny" (idem 010–013).
- Há melhorias nos projetos que deviam estar no template (ex.: ADRs de sessão/JWKS e de
  tratamento de erros escritos à parte), e decisões que o template já tem foram reescritas à mão
  em cada projeto (o "rate limit em tabela Postgres", hoje ADR-010 do template, existe em 3
  projetos com números diferentes).

**Objetivo**: uma skill `template-sync` que (1) traz as novidades do template para um projeto
via PR, sem nunca perder mudança do projeto e sem perguntar de novo o que já foi decidido;
(2) leva melhorias de um projeto de volta ao template via PR; (3) dá a visão de como cada
projeto está em relação ao template; e um aviso automático quando sai versão nova.

## 2. Não-Objetivos

- **Sem merge automático**, em nenhum dos lados: tudo termina em PR; o merge é do humano
  (regra 0; no projeto, merge = deploy em Prod).
- **Sem feature toggle** (decisão do humano): a skill só roda quando chamada, e o aviso é só
  uma issue.
- **Sem credencial do template com escrita nos projetos**: o template não empurra nada; cada
  projeto puxa.
- Não sincroniza o código do app (`src/`), specs/planos do projeto, ADRs próprios, nem o
  exemplo `examples/` e as specs/planos do próprio template.
- Não resolve semântica de domínio: o Claude junta textos e configs, não reescreve regra de
  negócio do projeto.

## 3. Fluxo do Usuário

**A. Aviso** — toda semana (e sob demanda), o workflow do projeto compara a versão do
`lastSync` com a Release mais nova do template. Atrás → abre ou atualiza **uma única** issue
`Template: N versões atrás (vX → vY)` com as notas das Releases do intervalo. Em dia → fecha a
issue, se aberta.

**B. Sync** — no projeto, o humano roda `/template-sync` (modo `sync`). O Claude:
1. Lê `.template-sync.json`, busca o template na Release mais nova e no commit do `lastSync`.
2. Classifica cada arquivo gerenciado (§5.2) e aplica os casos limpos sozinho.
3. Junta os casos "os dois mudaram", mostrando ao humano o que decidiu; pergunta só o que for
   assunto novo ou ambíguo.
4. Roda `npm test`/lint/type-check do projeto.
5. Abre um PR no projeto (template de PR, título `chore(template): sync vX → vY`), com:
   aplicados, juntados (com o porquê), pulados, e **candidatos a voltar ao template**.
6. O `lastSync` novo vai no mesmo PR: ao mergear, aquelas mudanças nunca mais são oferecidas.

**C. Adoção** (primeiro sync de um projeto antigo, sem `.template-sync.json`) — iniciada da
sessão do template (`/template-sync adotar <caminho do projeto>`), porque o projeto ainda não
tem a skill:
1. Propõe a versão-base do template (o commit do template com mais arquivos idênticos ao
   projeto); o humano confirma ou escolhe "sem base".
2. Com base: segue o fluxo B a partir dela. **Sem base** (projeto que é origem do template):
   todo arquivo gerenciado que difere é tratado como "os dois mudaram" e decidido um a um.
3. O PR de adoção instala a skill, o workflow de aviso, o `.template-sync.json` e move/renomeia
   o que colidir (ADRs, §5.4).

**D. Contribuir** — no projeto, `/template-sync contribuir <arquivo|assunto>` (ou a partir da
lista de candidatos do PR de sync). O Claude generaliza o conteúdo (remove nome do projeto,
contas, regras específicas; deixa agnóstico), aplica num clone local do template numa feature
branch e abre **PR no template**. A Release seguinte leva a melhoria aos demais projetos.

**E. Status** — na sessão do template, `/template-sync status`. Para cada projeto da lista
local (§5.6): versão, quantas versões atrás, arquivos divergentes, e o que **se repete em ≥ 2
projetos** fora do template (candidato forte a contribuir). Publica numa issue fixada no
repo do template, atualizada a cada execução.

## 4. Componentes

| Componente | Onde | Papel |
| --- | --- | --- |
| Skill `template-sync` | `.claude/skills/template-sync/SKILL.md` (gerenciada → chega aos projetos pelo próprio sync) | Modos `sync`, `adotar`, `contribuir`, `status`; o julgamento (juntar, generalizar, perguntar) |
| Motor determinístico | `scripts/template-sync.mjs` | Buscar o template numa versão, ler o manifesto, classificar arquivos, aplicar casos limpos, `git merge-file` nos de 3 vias, gerar relatório JSON para a skill. Sem rede além do `git fetch` |
| Manifesto | `template-sync.manifest.json` (raiz do template; gerenciado) | Globs `managed` e `ignore` (§5.1); fonte única do que é "do template" |
| Arquivo de controle | `.template-sync.json` (só no projeto, versionado) | `template` (URL do repo), `lastSync { version, commit, date }`, `projectOwned` (§5.3) |
| Workflow de aviso | `.github/workflows/template-sync-check.yml` (gerenciado) | `schedule` semanal + `workflow_dispatch`; issue única com rótulo `template-sync`. No template ele não faz nada (sem `.template-sync.json` → sai verde) |
| Lista de projetos | `~/.config/template-sync/projects.json` (local, **fora** de qualquer repo) | Caminhos locais dos projetos para o modo `status` |
| ADR-015 | `docs/adr/template/015-template-sync.md` | Registra a decisão |

## 5. Regras

### 5.1 O que é do template (manifesto)

- `managed` (padrão inicial, ajustável no plano): `CLAUDE.md`, `ARCHITECTURE.md`,
  `BEST_PRACTICES.md`, `SKILLS.md`, `CONTRIBUTING.md`, `README.md`, `.claude/**`, `.githooks/**`,
  `hooks/**`, `scripts/**`, `.github/**`, `docs/adr/template/**`, `docs/adr/000-template.md`,
  `docs/runbooks/**`, `docs/guides/**`, `docs/superpowers/specs/_TEMPLATE.md`, configs da raiz
  (`package.json`, `eslint.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.prettierrc`,
  `.gitignore`, `.env.local.example`), os testes dos scripts e hooks do template (**lista
  explícita** de arquivos em `tests/unit/`, não o glob — os testes do app moram na mesma pasta),
  `template-sync.manifest.json`.
- `ignore`: `examples/**`, `docs/superpowers/specs/*` e `plans/*` do template (exceto
  `_TEMPLATE.md`), `src/**`, `package-lock.json` (regerado por `npm install` quando
  `package.json` muda).
- Arquivo fora de `managed` nunca é tocado.

### 5.2 Classificação (base = template no `lastSync`, novo = template na Release alvo, projeto = HEAD)

| Caso | Ação |
| --- | --- |
| novo = base (template não mudou o arquivo) | nada |
| projeto = base | aplica o novo (inclui criar arquivo novo e apagar arquivo removido do template) |
| projeto = novo | nada (já igual) |
| os três diferem | `git merge-file`; sem conflito → aplica e lista como "juntado"; com conflito → o Claude resolve, preservando a intenção do projeto, e lista com o porquê |
| arquivo novo no template, mas já existe no projeto com outro conteúdo | pergunta ao humano |
| template apagou, projeto mudou | pergunta ao humano |
| caminho em `projectOwned` | nunca toca; lista como "do projeto" |

Mudanças decididas num sync **não voltam**: o próximo parte do `lastSync` novo. Uma mudança
**nova** do template num arquivo que o projeto alterou **é** oferecida (só a novidade).

Detalhes do motor:

- **Gerenciado = união** dos manifestos da base e do alvo (um arquivo que deixou de ser do
  template ainda é classificado, para não ficar órfão).
- **Renomes**: o motor detecta renomes do template entre base e alvo (`git diff -M`) e trata
  "caminho velho → caminho novo" como um arquivo só (projeto = base → move; projeto mudou →
  move e junta). Sem isso, a mudança de ADRs para `docs/adr/template/` (§5.4) apagaria ou
  perguntaria sobre cada ADR.
- **JSON** (`package.json`, `hooks/protect-main/config.json`, `.claude/settings.json`…): depois do
  `git merge-file`, o motor valida que o resultado é JSON válido; inválido → vira conflito para
  o Claude resolver. Itens que só existem por causa de `examples/` (ex.: o check
  `Walking Skeleton (example)` em `requiredChecks`, o job do exemplo no CI) são **apontados** no
  PR para o humano decidir, nunca removidos sozinhos.
- **Motor da versão alvo**: o sync roda o `scripts/template-sync.mjs` e segue a skill **do
  checkout da Release alvo**, não a cópia do projeto (que pode ser antiga). A cópia do projeto
  é só um arquivo gerenciado como outro qualquer.

### 5.3 `projectOwned`

Só para caminhos que o projeto assumiu de vez (ex.: arquivo do template que o projeto apagou
de propósito). Não é atalho para "não me pergunte mais": a regra de 5.2 já evita perguntar de
novo. O humano adiciona; o Claude só sugere.

### 5.4 ADRs do template em espaço próprio

- No **template**, os ADRs 001–014 passam para `docs/adr/template/NNN-*.md` (o
  `000-template.md` fica em `docs/adr/`), com todos os links atualizados. Mesmo caminho no
  template e nos projetos: sem reescrita de links no sync.
- Nos **projetos**, `docs/adr/NNN-*.md` é do projeto; a numeração dele segue livre.
- Na adoção, um ADR do projeto que seja cópia de um ADR do template (mesmo título/conteúdo
  quase igual) é proposto para remoção em favor de `docs/adr/template/`; os demais ficam.
- **Links quebrados pela mudança**: exceção única à regra "fora de `managed` nunca é tocado".
  No sync que traz a mudança de ADRs (e na remoção de cópias na adoção), o motor reescreve os
  links `docs/adr/0NN-…` → `docs/adr/template/0NN-…` nos arquivos do projeto **só** quando o
  link apontava para um ADR do template que mudou de lugar; cada arquivo tocado é listado no
  PR. Links para ADRs do próprio projeto nunca mudam.

### 5.5 Segurança e regras do template

- Tudo por PR, com o template de PR preenchido e UAT desmarcado (regra 0, ADR-014). O agente
  nunca mergeia.
- Conta `gh` correta antes de push/PR em cada repo, restaurando a padrão ao final (regra 5).
- Nunca copia `.env*`, segredos ou valores de runbook preenchidos no projeto para o template;
  `contribuir` deixa tudo agnóstico (nenhuma conta, repo ou nome de projeto).
- Runbooks com `<preencher>` já preenchidos no projeto: os valores do projeto prevalecem; só a
  estrutura nova do template entra.
- Árvore suja no projeto → o sync não começa.

### 5.6 Status agnóstico

A lista de projetos e o relatório nunca viram arquivo versionado do template (o template não
nomeia contas nem repos). O relatório é uma issue do repo do template (rótulo
`template-status`), substituída a cada execução.

**Repetições ≥ 2 projetos**: o motor só junta a matéria-prima por projeto (caminhos fora do
manifesto, títulos dos ADRs próprios, nomes de scripts/workflows/skills próprios); quem decide
o que é "a mesma melhoria" é o Claude, na skill. Algo que o template já cobre (ex.: o rate
limit, ADR-010) não é candidato a contribuir — é candidato a o projeto **adotar a versão do
template** e aparece assim no relatório.

### 5.7 Versões

O sync mira a **Release mais nova** (tag `vX.Y.Z` do ADR-014), nunca um commit solto da
`main`. `lastSync.commit` é o commit da tag (à prova de tag movida); `date` é só para leitura.

**Base sem tag** (toda adoção hoje: os 4 projetos saíram do template antes da `v0.1.0`):
`lastSync.version` aceita `null` com `commit` preenchido. "Versões atrás" conta as Releases
cujo commit vem depois de `lastSync.commit` na história do template; a issue de aviso diz
"base anterior às Releases" em vez de `vX`. Depois do primeiro sync, `version` sempre tem tag.

## 6. Dados

`.template-sync.json`:

```json
{
  "template": "https://github.com/<owner>/claude-clean-starter",
  "lastSync": { "version": "v0.2.0", "commit": "<sha>", "date": "2026-10-27" },
  "projectOwned": []
}
```

(`version` pode ser `null` só quando a base é anterior às Releases — §5.7.)

Validado na leitura (forma inválida → erro claro, não chuta). Relatório do motor: JSON com
uma entrada por arquivo `{ path, case, action, conflict? }` — a skill lê esse JSON, não o diff
cru.

## 7. Testes

- **Unit (motor)**: cada linha da tabela 5.2 com repositórios git temporários (base/novo/
  projeto); globs do manifesto (`managed`/`ignore`/fora, união base+alvo); renome com projeto
  intocado e com projeto alterado; JSON juntado inválido → conflito; reescrita de links só
  para ADRs do template movidos; `projectOwned`; `.template-sync.json` inválido e com
  `version: null`; árvore suja → recusa; escolha da Release mais nova; contagem de versões
  atrás a partir de commit sem tag; proposta de base na adoção (commit com mais arquivos
  idênticos).
- **Unit (workflow)**: config do `template-sync-check.yml` (`schedule`, `workflow_dispatch`,
  permissões mínimas `issues: write`, `contents: read`); lógica de "atrás/em dia" e issue única
  em função pura.
- **Docs**: links para `docs/adr/template/` válidos em todo o repo (nenhum link para
  `docs/adr/0NN-` que não exista).
- **Manual (aceitação)**: adoção do ContasMes.ai (mais perto do template) e um sync seguinte
  sem nada a fazer.

## 8. Critérios de Aceitação

- [ ] Sync num projeto com arquivo só mudado pelo template → aplicado; mudado pelos dois →
      juntado e listado no PR; mudado só pelo projeto → intocado.
- [ ] Segundo sync logo após o merge do primeiro → "nada a fazer", nenhuma pergunta.
- [ ] Mudança nova do template num arquivo que o projeto alterou → só a novidade é oferecida.
- [ ] Adoção de projeto sem base (origem) → cada divergência decidida com o humano; PR instala
      skill, workflow e `.template-sync.json`.
- [ ] ADRs do template em `docs/adr/template/`; nenhuma colisão com ADRs do projeto; links ok.
- [ ] Projeto atrás → uma única issue `template-sync` com as notas; em dia → issue fechada.
- [ ] `contribuir` → PR no template sem nome de projeto, conta ou segredo.
- [ ] `status` → issue no template com versão, atraso, divergências e repetições ≥ 2 projetos;
      nenhum arquivo do template cita os projetos.
- [ ] Nenhum merge feito pelo agente; nenhuma escrita na `main` de nenhum repo.
- [ ] `npm run lint`, `npm run type-check`, `npm test`, `npm run check:runbooks` verdes.

## 9. Itens Futuros

- Sync seletivo por assunto ("só os gates"), se os PRs de sync ficarem grandes demais.
- Template privado: o workflow de aviso precisaria de um token de leitura do template.

## 10. Decisões do Claudinho (a conferir pelo humano)

Tomadas na revisão da spec, sem mudar o que o humano pediu:

1. Base sem tag → `version: null` + `commit` (§5.7).
2. Renomes detectados pelo motor; manifesto = união base + alvo (§5.2).
3. Reescrita de links só para ADRs do template que mudaram de lugar, listada no PR (§5.4).
4. Repetições entre projetos: o motor junta a matéria-prima, o Claude julga (§5.6).
5. O sync roda o motor e a skill da Release alvo (§5.2).
6. JSON validado depois da junção; itens só do `examples/` apontados no PR, nunca removidos
   sozinhos (§5.2).
7. Testes do template em `tests/unit/` por lista explícita no manifesto (§5.1).
