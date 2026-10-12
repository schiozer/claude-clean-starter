# Spec: Governança operacional e runbooks para agentes

**Data**: 2026-10-11
**Status**: Aprovada
**Autor(es)**: Fabio Schiozer + Claudinho

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano e a
> implementação.

## 1. Contexto e Objetivo

O template já define **como construir** (ADRs 001–012, skills de implementação, walking
skeleton). Falta definir **como operar**: deploy, configuração de ambientes (Vercel, Neon,
Auth0), segredos, feature flags, migrações, habilitação do MCP e rollback — feitos cada vez
mais por **agentes**.

O template não tem projeto real (não há Vercel/Neon/Auth0 para operar aqui). Então o
objetivo é entregar **regras de governança + estrutura de runbooks** que todo projeto que
adotar o template **herda e é obrigado a completar**, de modo que:

1. um agente consiga executar deploy/configuração seguindo um runbook, passo a passo;
2. operações de alto impacto exijam **aprovação humana explícita por operação**;
3. operações proibidas ao agente (ex.: merge na `main` = deploy em Prod) sejam recusadas;
4. a conformidade seja **verificável no CI**, não só declarada.

**Sucesso** = um projeto recém-adotado tem o catálogo obrigatório de runbooks, o CI falha
enquanto houver lacunas (`<preencher>`) em modo estrito, e o agente executa qualquer runbook
via skill `runbook-execution` respeitando as classes de risco.

## 2. Não-Objetivos

- Executar qualquer operação real neste repositório (não há infra).
- Automatizar provisionamento (Terraform/Pulumi). Runbooks são procedimentos com comandos;
  IaC é decisão futura de cada projeto (ADR próprio).
- Checagem de frescor no CI (falharia PRs por passagem do tempo); o frescor é aplicado pela
  skill em tempo de execução.
- Ferramenta de aprovação externa (ChatOps). A aprovação é no próprio chat com o agente.
- Feature toggle: **não se aplica** — é processo/documentação, sem comportamento de runtime.

## 3. Fluxo do Usuário (agente + humano)

1. Humano pede: "faça o deploy em UAT" / "ligue a escrita MCP no UAT" / "rotacione a chave
   do Auth0".
2. Agente invoca a skill `runbook-execution` e localiza o runbook do catálogo.
3. Agente valida: runbook sem `<preencher>`; `Última verificação` ≤ 90 dias (senão avisa e
   eleva os passos mutantes a R2).
4. **Pre-flight** (R0): confere conta `gh`, team/scope Vercel, projeto/branch Neon e tenant
   Auth0 do ambiente-alvo. Divergência → para e informa.
5. Para cada passo: aplica o gate da classe (seção 5.1), executa, roda a **verificação** do
   passo e compara com o esperado.
6. Falha em passo ou verificação → executa a seção **Rollback** (passos também
   classificados) e informa.
7. Ao fim, **registra** a execução (seção 5.4).

Desvios: humano nega uma aprovação R2 → agente para sem executar o restante e registra
"interrompido por decisão humana". Passo R3 → agente entrega a instrução ao humano e espera
ele confirmar que fez, depois roda a verificação (R0).

## 4. Componentes

| Artefato | Papel |
| --- | --- |
| `docs/adr/013-governanca-operacional-e-runbooks.md` | Regras: classes de risco, gates, pre-flight, segredos, registro, rollback, frescor, placeholders, obrigação de adoção |
| `docs/runbooks/README.md` | Índice do catálogo, resumo das classes, como invocar |
| `docs/runbooks/_TEMPLATE.md` | Formato obrigatório de runbook |
| `docs/runbooks/*.md` (8, seção 5.6) | Catálogo obrigatório, pré-escrito para a stack padrão (Vercel/Neon/Auth0) com `<preencher>` só nos valores do projeto |
| `scripts/check-runbooks.mjs` | Validador de formato e catálogo (seção 5.5) |
| `tests/unit/checkRunbooks.test.ts` | Testes do validador + teste que valida o catálogo real do template |
| `package.json` (raiz) | script `check:runbooks` |
| `.github/workflows/ci.yml` | passo `npm run check:runbooks` no job da raiz |
| `.claude/skills/runbook-execution/SKILL.md` | Procedimento do agente para executar qualquer runbook |
| `.claude/commands/deploy-staging.md`, `deploy-prod.md` | Ficam finos: delegam a `deploy-uat.md` / `deploy-prod.md` via skill |
| `CLAUDE.md` | Regra 10 + `docs/runbooks/` na árvore + item "adoção" (seção 5.7) |
| `SKILLS.md` | Fase "Operação" com `runbook-execution` |
| `docs/guides/deploy-ci-guide.md` | Aponta para ADR-013 e runbooks; rollback deixa de ser "registre no ADR" e passa a ser o runbook |

## 5. Regras

### 5.1 Classes de risco (ADR-013)

Todo passo numerado de Pre-flight, Passos e Rollback leva **exatamente uma** tag:

| Classe | Exemplos | Gate |
| --- | --- | --- |
| `[R0]` leitura | status de deploy, logs, listar envs (só **nomes**), listar flags, `gh pr checks`, smoke test GET | Livre em qualquer ambiente |
| `[R1]` mutação reversível fora de Prod | push de branch / abrir PR (dispara UAT), env var **não-secreta** em Dev/UAT, flag em Dev/UAT (exceto escrita MCP), reset de branch Neon de Dev/preview, migração em Dev/preview | Agente executa e **registra** |
| `[R2]` alto impacto | qualquer mutação em Prod; criar/rotacionar/remover **segredo** em qualquer ambiente; migração em Prod; operação destrutiva (drop, delete de branch/projeto/tenant/cliente); ligar **escrita MCP** (`MCP_<CTX>_WRITE`) em qualquer ambiente; ligar DCR em Prod; promover/reverter deploy de Prod | **Aprovação humana explícita por operação** (5.2) |
| `[R3]` proibido ao agente | merge na `main` (= deploy Prod), push direto na `main`, force-push em branch compartilhada, ler/imprimir valor de segredo, desligar proteções (branch protection, required checks, RBAC, Deployment Protection, consentimento do DCR) | Agente **recusa**; escreve o passo como instrução ao humano (`[R3] Humano: …`) |

**Regra de elevação:** passo `[R1]` executado contra **Prod** vira R2 automaticamente;
qualquer passo de runbook **vencido** (5.3) que não seja R0 vira R2. Na dúvida entre duas
classes, vale a mais alta.

### 5.2 Protocolo de aprovação R2

Antes de executar, o agente mostra num bloco único: **operação** (comando exato, sem
segredos), **ambiente**, **efeito esperado**, **rollback** e pergunta "Aprovo esta operação?".
Só um "sim" explícito do humano **para aquela operação** autoriza. Aprovação não se estende a
outros passos, outros ambientes ou execuções futuras; silêncio ou resposta ambígua = não.

### 5.3 Regras transversais

- **Pre-flight de identidade** antes de qualquer R1+: conta `gh` ativa (regra 5 do
  CLAUDE.md), team/scope Vercel, projeto e branch Neon, tenant Auth0 — todos do ambiente-alvo,
  conforme os valores declarados no runbook. Divergência → para.
- **Segredos:** o agente nunca vê nem imprime o valor. O humano o digita no dashboard ou
  rodando `vercel env add <NOME> <ambiente>` num terminal separado, **fora da sessão do
  agente** (nunca pelo prefixo `!`, cuja saída cai no contexto); o agente verifica só a
  **presença do nome**. Nunca
  em commit, log, comentário de PR ou argumento de comando visível.
- **Rollback obrigatório:** todo runbook tem a seção; ela é executada em falha de passo ou de
  verificação, com os mesmos gates — salvo quando o próprio passo diz o que fazer na falha
  (a instrução do passo prevalece).
- **Frescor:** metadado `Última verificação` (data ISO). Mais de **90 dias** → aviso +
  elevação (5.1). Quem executa com sucesso um runbook não vencido pode atualizar a data via PR.
- **Placeholders:** `<preencher` em qualquer lugar torna o runbook **não executável**; o agente
  para e pede os dados (e propõe PR completando o runbook). `<gerado` (saída do bootstrap)
  bloqueia os demais runbooks, mas não o `bootstrap-ambientes.md`, que o grava via PR.
- **Desvio:** o agente não executa comando fora do runbook numa operação R1+. Se o runbook
  está errado ou incompleto, para, explica e propõe a correção via PR.

### 5.4 Registro

Toda execução com passo R1+ gera um registro: comentário no PR relacionado (`gh pr comment`)
ou, sem PR, numa issue com label `ops`. Conteúdo: runbook + data de `Última verificação`,
ambiente, passos executados com resultado, aprovações R2 (quem/quando, texto da operação),
passos R3 entregues ao humano, resultado final (`ok` | `rollback` | `interrompido`). Nunca
contém segredos. Publicar o registro é R1 (consequência da operação já autorizada).

### 5.5 Formato de runbook e validador

Formato (`_TEMPLATE.md`):

```markdown
# Runbook: <título>

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

## Objetivo
## Pré-condições
## Pre-flight
1. [R0] … Verificar: …
## Passos
1. [R1] <ação + comando> Verificar: <comando/observação + esperado>
## Verificação final
## Rollback
1. [R2] … Verificar: …
## Registro
```

`scripts/check-runbooks.mjs` (ESM, sem dependências; exporta funções puras + CLI
`node scripts/check-runbooks.mjs [--strict] [dir=docs/runbooks]`, exit 1 com erros
listados por arquivo):

- **Por arquivo** (todo `.md` do diretório exceto `README.md` e `_TEMPLATE.md`):
  1. metadados `**Responsável**:`, `**Última verificação**:`, `**Ambientes**:` presentes;
  2. `Ambientes` é uma lista separada por vírgula só com `Dev`, `UAT`, `Prod` (≥ 1, sem repetição);
  3. seções H2 presentes, nesta ordem: Objetivo, Pré-condições, Pre-flight, Passos,
     Verificação final, Rollback, Registro;
  4. Pre-flight, Passos e Rollback têm ≥ 1 item numerado; todo item numerado de topo
     começa com `[R0]`–`[R3]`;
  5. todo item numerado de Passos e Rollback contém `Verificar:`;
  6. todo item `[R3]` começa com `[R3] Humano:`;
  7. `--strict`: nenhum `<preencher` e `Última verificação` é data ISO válida
     (`AAAA-MM-DD` real, não o literal do template).
- **Catálogo**: `README.md`, `_TEMPLATE.md` e os 8 runbooks obrigatórios (5.6) existem.
  Runbooks extras do projeto são validados pelas mesmas regras.

O template roda sem `--strict` no CI (o catálogo tem `<preencher>` por design). O projeto
adotado troca para `--strict` no CI (5.7).

### 5.6 Catálogo obrigatório

| Arquivo | Conteúdo essencial (stack padrão) |
| --- | --- |
| `bootstrap-ambientes.md` | Criar projeto Vercel ligado ao repo; integração Vercel↔Neon (branch por preview); branches Neon Dev/UAT/Prod; tenants Auth0 por ambiente; envs por ambiente (nomes); alias estável do UAT; required checks + branch protection (`[R3] Humano`) |
| `deploy-uat.md` | Pre-flight; checks locais; push + PR (`[R1]`); aguardar preview; apontar alias UAT; smoke test (`[R0]`) |
| `deploy-prod.md` | UAT aprovado; PR verde e atualizado; `[R3] Humano:` merge; acompanhar deploy de Prod (`[R0]`); smoke test; rollback = `rollback.md` |
| `rollback.md` | Primeira resposta a incidente, do menos ao mais invasivo: desligar flag da feature (`[R2]` em Prod); promover deploy anterior (`[R2]`); revert por PR (`[R1]` + `[R3] Humano:` merge) |
| `migracao-banco.md` | ADR-008: migração em branch de preview (`[R1]`), verificação; em Prod (`[R2]`) com branch Neon de backup antes; rollback = restaurar do branch/point-in-time |
| `segredos-e-env.md` | Adicionar env não-secreta (`[R1]`/Prod `[R2]`); criar/rotacionar segredo (`[R2]`, humano digita o valor); redeploy; verificar presença do nome |
| `feature-flags.md` | ADR-006: ligar/desligar por ambiente; kill switch da feature (`<CTX>_ENABLED`) desliga também as tools MCP; escrita MCP sempre `[R2]` |
| `mcp-habilitar-e-conectar.md` | Auth0: API com audience = `MCP_RESOURCE_URL`, permissions, RBAC + permissions no token, DCR (Prod `[R2]`), conexões de domínio, resource→audience; envs `AUTH0_ISSUER_BASE_URL`/`MCP_RESOURCE_URL`; verificação `/.well-known/oauth-protected-resource` e 401 sem token; conexão do ChatGPT com dois usuários de teste (ref. `mcp-guide.md`) |

### 5.7 Obrigação de adoção

Ao adotar o template, o projeto **deve**, antes do primeiro deploy fora do Dev:

1. preencher todo `<preencher>` dos runbooks (valores reais: team Vercel, projeto Neon,
   tenants Auth0, URLs, responsáveis) e datar `Última verificação`;
2. trocar o passo do CI para `npm run check:runbooks -- --strict`;
3. adicionar um runbook (no formato) para cada operação recorrente nova do projeto.

O CLAUDE.md ganha a **regra 10**: "Operação de deploy/configuração só via runbook de
`docs/runbooks/` executado pela skill `runbook-execution`, respeitando as classes de risco
do ADR-013. Sem runbook para a operação → não executa; propõe o runbook via PR."

## 6. Dados

Sem dados de aplicação. O validador lê arquivos markdown do disco.

## 7. Testes

`tests/unit/checkRunbooks.test.ts` (Vitest, raiz), com markdown inline:

- runbook válido → sem erros;
- falta metadado / ambiente inválido / seção ausente / seções fora de ordem → erro específico;
- passo sem tag de classe; passo de Passos/Rollback sem `Verificar:`; `[R3]` sem `Humano:`;
- seção de passos vazia;
- não-estrito aceita `<preencher`; estrito rejeita `<preencher` e data literal/inválida;
- catálogo sem um runbook obrigatório → erro; runbook extra inválido → erro;
- **catálogo real** `docs/runbooks/` passa em modo não-estrito (trava o template).

Skill e docs: revisão manual + o validador sobre os runbooks.

## 8. Critérios de Aceitação

- [ ] ADR-013 aceito com classes R0–R3, regra de elevação, protocolo R2, regras transversais,
      registro e obrigação de adoção.
- [ ] `docs/runbooks/` com README, `_TEMPLATE.md` e os 8 runbooks, cada passo classificado e
      com verificação; merge na `main` só aparece como `[R3] Humano:`.
- [ ] `npm run check:runbooks` passa no template; `-- --strict` falha listando os
      `<preencher>`.
- [ ] Testes do validador passando; lint e type-check da raiz ok; CI roda `check:runbooks`.
- [ ] Skill `runbook-execution` descreve localizar → checar → pre-flight → gates → verificar
      → rollback → registrar.
- [ ] `deploy-staging`/`deploy-prod` delegam aos runbooks; `deploy-prod` não manda mais o
      agente fazer merge.
- [ ] CLAUDE.md (regra 10, árvore, adoção), SKILLS.md e deploy-ci-guide atualizados.

## 9. Itens Futuros

- IaC (Terraform/Pulumi) para bootstrap, com runbook chamando o plano/apply.
- Aprovação R2 via ChatOps (Slack) com trilha assinada.
- Checagem de frescor como aviso agendado (cron) em vez de no CI.
- Runbooks do pipeline nativo (EAS/TestFlight) quando houver app nativo.
