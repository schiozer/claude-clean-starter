# 014. Gestão de releases: gates de PR, squash e SemVer por merge

**Data**: 2026-10-25
**Status**: Aceito

## Contexto

Cada merge na `main` é um deploy de Prod ([ADR-002](./002-estrategia-de-ambientes.md)), mas
não havia versão, histórico de mudanças legível nem garantia de que o PR declarasse sua spec,
tivesse o UAT feito ou entregasse o que a spec prometia. Plano gratuito do GitHub com
repositório privado: sem branch protection com required checks, sem required reviewers de
Environment. O agente e o humano usam a **mesma conta git/gh** do projeto (regra 5).

## Decisão

- **Template de PR** (`.github/pull_request_template.md`) com `Spec:`, tabela `Spec × código`,
  checklist e UAT.
- **`PR gate`** (`scripts/pr-gate.mjs`): valida o título (`tipo(escopo): mensagem`), a linha
  `Spec:` (obrigatória e com arquivo existente para `feat`, `refactor` e `!`; `n/a — motivo`
  nos demais) e recusa UAT marcado no `opened`.
- **Conferência local** pelo Claudinho (instrução, não script) antes de abrir/atualizar o PR.
- **Gate `Spec × código` com Claude**, opcional atrás da variável `SPEC_GATE`
  (runbook [`spec-gate.md`](../runbooks/spec-gate.md)). É o **único toggle permanente**: o
  critério de remoção do [ADR-006](./006-processo-de-feature-e-feature-toggle.md) não se aplica,
  porque depende de uma chave paga, de custo e de decisão do dono do repositório. Action
  `anthropics/claude-code-action` fixada por SHA de commit (v1.0.262); atualizar é trocar o SHA
  por PR. Modelo default `claude-sonnet-5-5`, trocável por `SPEC_GATE_MODEL`. Claude restrito a
  Read/Grep/Glob (Bash/Write/Edit/WebFetch/WebSearch negados); entradas não confiáveis cercadas
  por nonce por execução; prompt inteiro limitado a 100 000 bytes UTF-8 (corta o diff, depois a
  spec). As actions first-party (`actions/checkout`, `actions/setup-node`) ficam fixadas por tag,
  como no `ci.yml`; só a action do Claude, de terceiro e com acesso à chave, é fixada por SHA —
  escolha consciente.
- **`Guarda da main` estendida**: no merge, alarma (issue/rótulo `merge-sem-gates`) se faltou
  algum check de CI exigido (`requiredChecks` em `hooks/protect-main/config.json`, que inclui o
  `PR gate`), `Spec × código` (quando `SPEC_GATE=on`) ou UAT marcado, ou se o merge não foi
  squash (merge commit com 2 pais alarma). Checks ainda rodando são aguardados por até 5 min.
- **Squash obrigatório**: o título do PR é a mensagem do commit e a **fonte da versão**
  (a release lê o título do PR, pois o humano pode editar a mensagem no merge).
- **SemVer por merge** (`scripts/release.mjs`, `release.yml`): tag anotada + GitHub Release a
  cada merge. Sem tags, a primeira versão é a do `package.json` (0.1.0), sem bump. Depois:
  `!`/`BREAKING CHANGE` → major, `feat` → minor, demais → patch (SemVer estrito também abaixo
  de 1.0.0). As **Releases do GitHub são o CHANGELOG**; não há `CHANGELOG.md` nem bump do
  `package.json` (exigiriam commit na `main` fora de PR).
- **UAT só pelo humano**: regra `[R3]` no `CLAUDE.md`, hook `protect-main` (barra `[x] UAT` no
  texto de `gh pr create/edit` e `gh api …/pulls…`) e checagem do `PR gate` no `opened`.

## Consequências

- Histórico da `main` com um commit por PR e uma versão por deploy; changelog automático.
- Custo apenas se o gate com Claude estiver ligado; desligado, nada roda.
- Mais disciplina na abertura do PR (template, spec declarada).

### Limites honestos

1. **Gate é check visível + alarme, não bloqueio.** No plano gratuito não há como impedir o
   merge; a `Guarda da main` alarma depois (`merge-sem-gates`). O merge continua sendo do humano.
2. **UAT garantido por regra, não por identidade.** Com conta compartilhada, checkbox, label e
   histórico de edição registram a conta, não quem digitou. Valem regra + hook + checagem do
   `PR gate` no `opened`. O hook não enxerga corpo vindo de arquivo (`--body-file`) nem pipe;
   uma edição posterior por caminho invisível ao hook é indistinguível da do humano.
3. **Workflows rodam o código do próprio PR.** Quem tem escrita pode reescrever um gate dentro do
   PR. A `Guarda da main` no merge e a revisão humana são a retaguarda; endurecer com
   `pull_request_target`/workflows da base é alternativa futura. PRs de fork não recebem
   secrets: o gate com Claude fica vermelho (`no-key`). Um prompt injection no diff pode levar o
   Claude a ler arquivos do runner (ex.: `/proc/*/environ`) e ecoá-los no comentário; aceito
   porque só quem tem escrita dispara o gate, e esse já pode reescrever o próprio workflow.
4. **Concorrência da release.** O GitHub mantém só uma execução pendente por grupo de
   concorrência: com 3+ merges em sequência rápida, uma execução intermediária pode ser
   cancelada e aquele merge fica sem tag. Re-rodar depois essa execução do meio calcula a versão
   a partir das tags atuais e pode sair **fora de ordem** (maior que a de um merge posterior).
   Recuperar com versão explícita (`gh release create vX.Y.Z --target <sha>`) ou aceitar o salto e
   registrá-lo na Release. Se a tag foi criada mas a Release falhou, o re-run detecta a Release
   ausente e a cria para a tag existente.
5. **Gate com Claude é probabilístico**: vermelho só para critério `fora`, divergência
   bloqueante ou falha técnica; o resto é aviso, para evitar falso positivo que todos ignoram.

## Alternativas Consideradas

- **release-please**: agrupa vários merges num PR de release e desalinha versão × deploy.
- **commitlint/husky**: dependência a instalar; o `PR gate` valida o título sem dependências.
- **`CHANGELOG.md` versionado**: exigiria commit na `main` fora de PR.
- **Branch protection / required checks**: indisponível no plano gratuito privado.
- **Conta separada para o agente**: daria garantia real de identidade para o UAT; adiada
  (item futuro da spec).
