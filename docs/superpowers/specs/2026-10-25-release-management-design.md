# Spec: Release management — esteira PR → UAT → Prod com gates de saúde

**Data**: 2026-10-25
**Status**: Aprovada
**Autor(es)**: Fabio Schiozer + Claudinho

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano e a
> implementação. Vira o **ADR-014** (release management) e fecha os "Itens futuros" da
> [spec de 2026-10-23](./2026-10-23-protecao-main-por-pr-design.md) §9 (SemVer/tags,
> CHANGELOG, template de PR, estratégia de merge, padrão de commit).

## 1. Contexto e Objetivo

A esteira já existe e **não muda**: três ambientes (Dev local / UAT / Prod — ADR-002); abrir ou
atualizar um PR faz deploy em UAT; o merge na `main` faz deploy em Prod; a `main` só muda via
PR e o merge é do humano (ADR-005, regra 0).

Falta o que o humano pediu (literal): "precisamos de guardrails e gates para garantir a saúde,
então é preciso bater o código contra a especificação e para isso devemos ter sempre registrado
a especificação com código". E: "eu imagino você analisando o código contra a especificação".

**Objetivo**: todo PR passa, antes do merge, por gates visíveis no próprio PR — CI, padrão do
título, vínculo com a spec, **análise do código contra a spec feita pelo Claude** e aprovação do
UAT pelo humano. Todo merge na `main` vira uma versão SemVer com notas de release. Merge que
furar um gate gera alarme.

**Sucesso** = (a) nenhum PR de feature chega à `main` sem spec registrada; (b) o PR mostra, por
critério de aceitação da spec, onde o código o atende; (c) um check do GitHub com o Claude aponta
divergências spec × código; (d) cada deploy de Prod corresponde a uma tag `vX.Y.Z` com release
notes; (e) merge com gate vermelho ou sem UAT vira issue de alarme; (f) tudo coberto por testes.

## 2. Não-Objetivos

- Mudar a esteira (gatilhos de deploy, ambientes, Vercel/Neon/Auth0).
- Impedir o merge tecnicamente: sem branch protection (plano gratuito, repo privado), o GitHub
  não bloqueia merge com check vermelho. O gate é **visível + alarme** (como a camada 3 do ADR-005).
- `CHANGELOG.md` commitado (exigiria escrita na `main` fora de PR — ver §6).
- commitlint/husky ou outra dependência npm: com squash, só o **título do PR** chega à `main`, e
  ele é validado no CI.
- Bump do `version` do `package.json` a cada release (mesmo motivo do CHANGELOG).
- Revisão de qualidade de código geral pelo Claude no CI (o gate é **spec × código**).

## 3. Visão geral

```
PR aberto/atualizado
 ├─ CI (já existe)            lint, type-check, testes, check:runbooks
 ├─ PR gate (novo, fixo)      título `tipo(escopo): msg`; linha `Spec:` válida; checkbox de UAT
 ├─ Spec × código (novo, TOGGLE SPEC_GATE)   Claude lê spec + diff → check + comentário
 └─ deploy UAT (já existe) → humano testa → marca "UAT aprovado" no PR
merge (squash, humano)
 ├─ Guarda da main (estendida)  PR mergeado E gates verdes E UAT marcado; senão alarme
 └─ Release (novo)              tag vX.Y.Z + GitHub Release com notas
```

Antes de abrir o PR, o Claudinho faz a mesma conferência spec × código localmente e preenche a
seção de evidências do PR (§4.3) — primeira linha, sem custo.

## 4. Componentes

### 4.1 Template de PR — `.github/pull_request_template.md` (fixo)

Seções, nesta ordem:

- `## O quê` / `## Por quê` (texto livre).
- Linha obrigatória, uma das duas formas:
  - `Spec: docs/superpowers/specs/<arquivo>.md`
  - `Spec: n/a — <motivo>` (ex.: `Spec: n/a — fix do bug #12`)
- `## Spec × código` — tabela `| Critério (seção "Critérios de Aceitação" da spec) | Onde é atendido (arquivo/teste) | Status |`,
  preenchida pelo autor (o Claudinho, quando ele abre o PR). Status: `ok` | `parcial` | `fora`.
- `## Checklist` — o "Checklist Antes de Commitar" do `CLAUDE.md`.
- `## UAT` — exatamente um destes marcado, **só pelo humano** (§4.7):
  - `- [ ] UAT aprovado`
  - `- [ ] UAT não se aplica — <motivo>` (ex.: só docs/CI)

### 4.2 PR gate — `scripts/pr-gate.mjs` + job em `.github/workflows/pr-gate.yml` (fixo)

Determinístico, sem Claude, sem custo. Roda em `pull_request` (`opened`, `edited`,
`synchronize`, `reopened`) para a `main`. Check com nome **`PR gate`**. Regras:

1. **Título** casa `^(feat|fix|refactor|docs|style|test|chore|ci|perf|build|revert)(\([a-z0-9-]+\))?!?: .+`
   e tem ≤ 72 caracteres (BEST_PRACTICES → Git).
2. **Spec**: o corpo tem exatamente uma linha `Spec:` em uma das duas formas de §4.1.
   - Forma com caminho: o arquivo existe **no head do PR**, fica em `docs/superpowers/specs/` e
     não é o `_TEMPLATE.md`.
   - `n/a` é **recusado** para `feat`, `refactor` e títulos com `!` (mudança de comportamento ou
     quebra); aceito para os demais tipos, com motivo não vazio.
3. **UAT**: o gate **não** exige o checkbox marcado (o UAT acontece depois que o PR abre); só
   valida que a seção existe com as duas opções. A exigência do UAT marcado é da Guarda (§4.5).
   No evento `opened`, qualquer opção de UAT já marcada → **vermelho** ("o UAT é marcado pelo
   humano depois de testar"): quem abre o PR é o agente, então marcado na abertura não foi o
   humano (§4.7).

Lógica em funções puras testáveis (título, corpo e "arquivo existe" injetados); o job só lê o
evento (`GITHUB_EVENT_PATH`) e o checkout do head. Mensagem de falha lista cada regra quebrada e
como corrigir (editar título/corpo re-dispara o gate via `edited`).

### 4.3 Conferência local pelo Claudinho (fixa)

Antes de `gh pr create`/atualizar o PR, o Claudinho lê a spec declarada e o diff contra a `main`,
preenche a tabela `Spec × código` e aponta no PR o que ficou `parcial`/`fora`. Vira passo
obrigatório na regra de entrega do `CLAUDE.md` (junto da `verification-before-completion`) e no
`SKILLS.md`. Não é um script: é instrução ao agente.

### 4.4 Gate "Spec × código" com Claude — `.github/workflows/spec-gate.yml` (**TOGGLE**)

- Gatilho: `pull_request` (`opened`, `synchronize`, `reopened`, `edited`) para a `main`.
  Em `edited`, só roda se mudou a linha `Spec:` ou a tabela `Spec × código` (compara com
  `github.event.changes.body.from`); marcar o UAT ou mudar o título **não** re-roda o Claude
  (custo e variação do veredito). `concurrency: { group: spec-gate-<n.º do PR>,
  cancel-in-progress: true }` (não paga análise de commit já superado).
- **Toggle**: variável de repositório do GitHub Actions `SPEC_GATE` (não secreta).
  - `on` → o job roda; check **`Spec × código`**.
  - ausente ou qualquer outro valor → o job é **pulado** (`if: vars.SPEC_GATE == 'on'`) e a
    Guarda não o exige (§4.5).
  - Default do template: **desligado** (variável ausente). Neste repositório: o humano liga
    (`on`), já tem a chave. Toggle **permanente de configuração** (opt-out por custo), não
    temporário — o critério de remoção do ADR-006 não se aplica; registrar isso no ADR-014.
- Ligado e sem o secret `ANTHROPIC_API_KEY` → check **vermelho** com mensagem "configure o
  secret ou desligue `SPEC_GATE`" (fail-closed, nunca verde silencioso).
- `Spec: n/a` → check verde com resumo "sem spec declarada; nada a conferir" (o PR gate já
  decidiu se `n/a` é aceitável). Spec declarada → o Claude analisa.
- Execução: `anthropics/claude-code-action`, fixada numa versão `v1` que suporte saída
  estruturada (`claude_args: --json-schema …` → output `structured_output`), com
  `github_token: ${{ secrets.GITHUB_TOKEN }}` (sem OIDC) e o comentário de acompanhamento
  próprio da action **desligado** (o comentário é do nosso script). Modelo pela variável
  `SPEC_GATE_MODEL` (default `claude-sonnet-5-5`). Ferramentas permitidas ao Claude: só
  Read/Grep/Glob (sem Bash, Write/Edit, WebFetch/WebSearch); o diff vai **no prompt**, gerado
  por um passo anterior (`git diff base...head`).
- O que o Claude recebe: a spec declarada (os critérios são a seção com título "Critérios de
  Aceitação", achada pelo título, não pelo número), o diff, a tabela `Spec × código` do PR.
  O que ele produz (saída estruturada validada por `scripts/spec-gate.mjs`): por critério,
  `ok | parcial | fora | sem-teste` + evidência, e uma lista de `divergencias` (código que faz
  algo que a spec não pede ou contradiz), cada uma `bloqueante: true|false`.
- **Veredito**: vermelho se algum critério é `fora`, ou se há divergência marcada como
  `bloqueante`; amarelo não existe — `parcial`/`sem-teste` e divergências não bloqueantes saem
  verdes com aviso no comentário. JSON inválido ou ausente → vermelho (fail-closed).
- Comentário **único e atualizado** no PR (procura um marcador `<!-- spec-gate -->` e edita),
  com a tabela do Claude, as divergências e o custo estimado da execução, se a action o expuser.
- Segurança: `permissions: { contents: read, pull-requests: write }` (token do GitHub passado
  explicitamente; sem `id-token`); o corpo do PR, a spec e o
  diff são **dados não confiáveis** (o prompt instrui a ignorar instruções contidas neles); PR de
  fork não recebe secret → vermelho com a mensagem acima (aceitável: repo privado).
- Custo: limite mensal configurado no console da Anthropic (runbook §4.8).

### 4.5 Guarda da main estendida — `scripts/main-guard.mjs` (fixa)

Hoje: cada commit do push precisa de PR mergeado com base `main`. Passa a exigir também, para
cada PR mergeado encontrado:

- checks do **head do PR** (a execução mais recente de cada nome — `check-runs?filter=latest`)
  com conclusão `success` (`skipped` não conta como sucesso): os jobs do CI (`Test & Lint (root)`,
  `Walking Skeleton (example)`), `PR gate` e — só se `SPEC_GATE` = `on`, passado ao job como env
  — `Spec × código`. Lista dos checks obrigatórios em `hooks/protect-main/config.json`
  (`requiredChecks`), fonte única; `Spec × código` entra condicionalmente pelo toggle, lido
  **no momento do merge**: ligar `SPEC_GATE` com PRs abertos exige re-rodar o check neles
  (a mensagem do alarme diz isso).
- corpo do PR com `- [x] UAT aprovado` **ou** `- [x] UAT não se aplica — <motivo não vazio>`.
- commit com **um único pai** (squash); merge commit → alarme.

Falha de gate usa o mesmo mecanismo de alarme (job vermelho + issue), com rótulo próprio
**`merge-sem-gates`** e título `Merge sem gates: #<PR> (<sha7>)`, listando o que faltou. As
retentativas existentes valem também para a leitura dos checks.

### 4.6 Release — `scripts/release.mjs` + `.github/workflows/release.yml` (fixo)

- Gatilho: `push` na `main`. `permissions: { contents: write, pull-requests: read }`.
  `concurrency: { group: release, cancel-in-progress: false }` (versões em ordem).
- Para cada push: acha o PR mergeado do commit (`commits/{sha}/pulls`); usa o **título do PR**
  (cai para o assunto do commit se não houver PR).
- Próxima versão a partir da **maior tag** `vX.Y.Z` existente: `!` no título ou
  `BREAKING CHANGE` no corpo do PR → major (SemVer estrito, inclusive abaixo de `1.0.0`:
  `0.4.2` + quebra → `1.0.0`); `feat` → minor; demais → patch. Sem tag nenhuma →
  a primeira versão é o `version` do `package.json` (aqui `0.1.0`), sem bump.
- Cria a tag **anotada** `vX.Y.Z` no commit (API `git/tags` e depois `git/refs`, `refs/tags/…` — não toca
  `refs/heads/*`, então não conflita com a trava) e uma **GitHub Release** com notas: título do PR,
  link do PR, link para a spec declarada, `Spec × código` (ok/pulado) e UAT (aprovado/n.a.).
- Push com vários commits (não deveria acontecer com squash) → uma release com a lista; a Guarda
  já alarma.
- Idempotente: se a tag do commit já existe, não faz nada.
- A release é criada mesmo se a Guarda alarmar (reflete o que está em Prod); as notas não
  dependem da Guarda.
- O "CHANGELOG" do projeto = a página de Releases do GitHub. O `README` aponta para ela.

### 4.7 Quem marca o UAT (fixo)

O agente faz push e abre PRs com a **mesma conta** do humano (a conta git/gh do projeto — regra 5). Para o GitHub,
tudo é a mesma pessoa: checkbox, label, comentário e histórico de edição registram a conta, não
quem estava ao teclado; review "Approve" do próprio PR não é permitida; e os _required reviewers_
de Environment não existem no plano gratuito com repositório privado. Decisão do humano:
**checkbox + regra**, com a garantia por regra, não por identidade.

- **Regra** (`CLAUDE.md`, nova linha em `[R3]`): o agente **nunca** marca nenhuma opção de UAT
  — nem ao abrir o PR, nem editando o corpo depois. Ele avisa o humano que o UAT está pendente.
- **Hook `protect-main`** (camada 2, melhor esforço léxico): barra `gh pr edit`/`gh pr create`
  e `gh api …/pulls…` cujo texto do comando contenha uma opção de UAT marcada
  (`[x] UAT`, case-insensitive). Corpo vindo de arquivo (`--body-file`) não é visível ao hook —
  por isso o item seguinte.
- **PR gate** recusa UAT marcado no `opened` (§4.2, regra 3).
- **Limite honesto** (registrar no ADR-014): uma edição posterior do corpo pelo agente, por um
  caminho que o hook não veja, é indistinguível da do humano. A saída real é uma conta separada
  para o agente (§10).

### 4.8 Configuração e docs

- **Runbook novo** `docs/runbooks/spec-gate.md` (ADR-013): criar conta pessoal no console da
  Anthropic, crédito e **limite mensal**, criar a chave, gravar o secret `ANTHROPIC_API_KEY` no
  GitHub (`[R2]`, humano, nunca colar no chat), ligar/desligar `SPEC_GATE` (`gh variable set
  SPEC_GATE --body on`, `[R1]`), conferir com um PR de teste. Alerta: **não** usar chave ou
  assinatura corporativa num repositório pessoal (regra 5).
- **`bootstrap-ambientes.md`**: novo passo `[R3]` humano — Settings → Pull Requests: só "Allow
  squash merging", com "Default to pull request title"; conferir com
  `gh api repos/<owner/repo> --jq '.allow_squash_merge, .allow_merge_commit, .allow_rebase_merge, .squash_merge_commit_title'`
  → `true false false PR_TITLE`. (O humano ainda pode editar a mensagem no merge; por isso a
  release usa o **título do PR**, não a mensagem do commit.) Passo 10 passa a listar `PR gate` (e `Spec × código` se ligado) como
  checks esperados.
- **`deploy-prod.md`**: pré-condição "gates verdes e UAT marcado no PR"; registro cita a tag gerada.
- **ADR-014** `docs/adr/014-release-management.md`: decisão (gates, squash, SemVer por merge,
  Releases como CHANGELOG, toggle só no gate com Claude), consequências e alternativas
  (release-please, commitlint, CHANGELOG.md, branch protection).
- **`CLAUDE.md`**: regra de entrega inclui a conferência local (§4.3) e o template de PR; `[R3]`
  ganha "marcar o UAT no PR" (§4.7); nota de adoção: não remover `pr-gate.yml`, `release.yml`, e
  decidir `SPEC_GATE`.
- **`BEST_PRACTICES.md`** (Git): squash; título do PR = mensagem do commit; versão por tag.
- `SKILLS.md`, `README.md`, `CONTRIBUTING.md`: referências curtas.

## 5. Regras

- O título do PR é a mensagem do commit na `main` (squash) e a fonte da versão.
- Spec obrigatória para `feat`, `refactor` e quebra (`!`); `n/a` com motivo para os demais.
- UAT marcado é exigido no merge (Guarda), não na abertura (PR gate).
- `SPEC_GATE` desligado = sem custo, sem check do Claude, e a Guarda não o exige; os demais
  gates continuam valendo.
- Sem dependências npm novas; só `node:` built-ins (o workflow do Claude usa a action oficial).
- Mensagens e docs em pt-BR; código em inglês.

## 6. Decisões do Claudinho (para conferência)

- **Squash obrigatório** + título validado no CI, em vez de commitlint (nada a instalar; o
  histórico da `main` fica um commit por PR).
- **Uma versão por merge** (cada merge é um deploy de Prod), em vez de release-please (que
  agrupa vários merges num PR de release e desalinha versão × deploy).
- **Releases do GitHub como CHANGELOG**, sem `CHANGELOG.md` nem bump do `package.json`: ambos
  exigiriam um commit na `main` fora de PR. O `version` do `package.json` só semeia a 1ª tag.
- `n/a` aceito para tipos que não mudam comportamento; recusado para `feat`/`refactor`/`!`.
- Gate do Claude: vermelho só para critério `fora`, divergência `bloqueante` ou falha técnica;
  o resto é aviso — para não virar um gate que todo mundo ignora por falso positivo.
- Modelo default `claude-sonnet-5-5` (custo × qualidade), trocável por `SPEC_GATE_MODEL`.
- A conferência local é instrução ao agente, não script.
- Guarda: rótulo separado `merge-sem-gates`; exige commit com um pai (squash).
- Release criada mesmo com alarme da Guarda.
- `edited` só re-roda o Claude se a linha `Spec:` ou a tabela mudou (marcar UAT não custa nada).
- SemVer estrito também abaixo de `1.0.0` (quebra → major); tag anotada.
- `SPEC_GATE` lido no merge pela Guarda; ligá-lo com PRs abertos exige re-rodar o check neles.
- Guarda usa a execução mais recente de cada check; `skipped` não é sucesso.
- O "UAT só pelo humano" ganha dois reforços além da regra: o hook barra comandos com
  `[x] UAT` e o PR gate recusa UAT marcado no `opened`.

## 7. Decisões do humano

- Esteira inalterada: PR → UAT, merge → Prod; Dev é local.
- Gate central: "você analisando o código contra a especificação"; spec sempre registrada com
  o código.
- Usar **chave pessoal** da API da Anthropic (criada pelo humano), não a assinatura corporativa.
- **Feature toggle só no gate com Claude** (o que tem custo): "o arquiteto pode definir não usar
  a funcionalidade para não pagar, o resto entra como parte do template fixo".
- **UAT marcado só pelo humano** via checkbox + regra (opção 1), aceitando o limite de conta
  compartilhada; conta separada para o agente fica para o futuro.
- PRs sem spec, merge, versionamento, CHANGELOG e template de PR: delegado ao Claudinho
  ("manda bala") — ver §6.

## 8. Testes

- **Unit `pr-gate.mjs`**: títulos válidos/inválidos (tipos, escopo, `!`, >72); linha `Spec:`
  ausente, duplicada, caminho inexistente, fora de `docs/superpowers/specs/`, `_TEMPLATE.md`,
  `n/a` sem motivo, `n/a` em `feat`/`refactor`/`!` (recusa) e em `fix`/`docs` (aceita); seção de
  UAT ausente; UAT marcado no `opened` (recusa) e no `edited` (aceita).
- **Unit camada 2** (`protectMainEvaluate.test.ts`): BLOCKED `gh pr edit 3 --body "… - [x] UAT
  aprovado"`, `gh pr create --body "- [X] uat não se aplica — docs"`, `gh api -X PATCH
  repos/o/r/pulls/3 -f body='- [x] UAT aprovado'`; ALLOWED `gh pr create --body "- [ ] UAT
  aprovado"`, `gh pr view 3`.
- **Unit `release.mjs`**: cálculo de versão (sem tags → `package.json`; `feat`/`fix`/`!`/
  `BREAKING CHANGE`; ignora tags fora de `vX.Y.Z`; maior tag, não a mais recente); idempotência;
  fallback para assunto do commit; corpo das notas.
- **Unit `main-guard.mjs`**: PR mergeado com todos os checks → ok; check faltando/falho →
  alarme `merge-sem-gates`; `Spec × código` exigido só com `SPEC_GATE=on`; UAT desmarcado →
  alarme; `n.a.` sem motivo → alarme; merge commit (2 pais) → alarme; comportamento atual
  (`main-sem-pr`) intacto.
- **Unit spec-gate**: o script que valida o JSON do Claude (veredito, JSON inválido → vermelho,
  secret ausente → vermelho, `Spec: n/a` → verde); montagem do comentário com marcador.
- **Config**: `pr-gate.yml`/`spec-gate.yml`/`release.yml` com gatilhos e permissões esperados;
  `spec-gate.yml` tem `if: vars.SPEC_GATE == 'on'`; `requiredChecks` do `config.json` ⊆ nomes
  de jobs dos workflows; template de PR contém as seções de §4.1.
- **Manual (aceitação)**: um PR real neste repo com `SPEC_GATE=on` mostra o check e o comentário;
  um merge gera a tag e a release.

## 9. Critérios de Aceitação

- [ ] PR com título fora do padrão, sem linha `Spec:`, ou `feat` com `Spec: n/a` → `PR gate`
      vermelho com a correção indicada; corrigir o título/corpo re-roda o gate.
- [ ] PR com spec válida e `SPEC_GATE=on` → check `Spec × código` e comentário único com a
      tabela critério × evidência; critério `fora` → vermelho.
- [ ] `SPEC_GATE` ausente → o check do Claude é pulado e nada é cobrado; os demais gates valem.
- [ ] `SPEC_GATE=on` sem `ANTHROPIC_API_KEY` → vermelho com instrução.
- [ ] Merge com gate vermelho, sem UAT marcado ou não-squash → issue `merge-sem-gates`.
- [ ] O agente é barrado ao tentar marcar o UAT por comando; PR aberto com UAT marcado →
      `PR gate` vermelho.
- [ ] Merge na `main` → tag `vX.Y.Z` correta e GitHub Release com link do PR e da spec.
- [ ] Template de PR, runbook `spec-gate.md`, passo de squash no bootstrap, `deploy-prod.md`,
      ADR-014, `CLAUDE.md`, `BEST_PRACTICES.md`, `SKILLS.md`, `README.md`, `CONTRIBUTING.md`
      atualizados.
- [ ] `npm run lint`, `npm run type-check`, `npm test`, `npm run check:runbooks` verdes.

## 10. Itens Futuros

- **Conta separada para o agente** (conta de máquina com token restrito ao repo): o UAT vira
  review "Approve" do humano e a Guarda confere o autor da aprovação — garantia por identidade.
- Se o plano permitir (repo público ou pago): Environment `Production` com _required
  reviewers_, como a branch protection opcional do ADR-005.
- Exigir o gate do Claude também em UAT (re-análise quando a spec muda).
- Rodar migrações de banco como gate da release.
- Notas de release agregadas por período (resumo mensal).
