# Spec: AI-BOM e consumo de tokens no desenvolvimento (parte A)

**Data**: 2026-11-27
**Status**: Aprovada (2026-11-27; cenários revisados pelo mantenedor no papel de QA — feature só de tooling)
**Autor(es)**: Fabio Schiozer, Claudinho

> Produzida pela skill `superpowers:brainstorming`. Parte **A** (consumo ao desenvolver). A parte
> **B** (consumo de LLM pelo produto em uso) é outra spec, depois desta. Complementa o
> [ADR-022](../../adr/template/022-politica-de-modelo-esforco-e-tokens.md), que é só política.
> Decisão a registrar no ADR-023.

## 1. Contexto e Objetivo

Hoje o template diz **como** gastar menos tokens (ADR-022, hook `read-guard`), mas não **mede**
nada e não lista os componentes de IA que o projeto usa. Os projetos passam a rodar sob limites de
token, e o mantenedor quer:

- **controlar o gasto**: ver o consumo e ser **alarmado** antes de estourar um teto mensal;
- **ter indicadores de auditoria**: histórico durável de consumo por projeto, modelo e origem, e um
  inventário (AI-BOM) dos componentes de IA.

Também é objetivo **aprender** observabilidade de IA com a stack de mercado (OpenTelemetry +
Grafana), que será reaproveitada na parte B.

Escopo: o consumo de quem **constrói** os projetos — sessões do Claude Code (sessão principal e
subagentes) e o gate Spec × código no CI (`spec-gate.yml`) — neste template e nos 4 derivados
(AssistBru, ContasMes, EvoluiAI, PerformaRM), que recebem tudo pelo `/template-sync`.

## 2. Não-Objetivos

- Consumo de LLM pelo **produto** em produção e contagem de chamadas a tools MCP (parte B).
- Bloquear uso ao atingir o teto: aqui só **alarma**; nada interrompe sessão nem CI.
- Exportar o **texto** de prompts ou respostas (`OTEL_LOG_USER_PROMPTS` fica desligado).
- Fixar `model`/`effortLevel` ou endpoints de telemetria no `.claude/settings.json` do time
  (ADR-022: configuração pessoal).
- Visão de time multiusuário com controle de acesso, e importar o histórico anterior dos
  `~/.claude/projects/*.jsonl`.
- Self-host de coletor, Prometheus ou Grafana.

**Anti-objetivos** (seria falha mesmo funcionando): segredo ou dado pessoal de uso versionado no
repositório; telemetria ligada sem o dono saber; quebra do CI ou do sync nos projetos que não
ligarem a feature.

## 3. Abordagens consideradas

1. **Grafana Cloud no dia a dia + resumo diário no Neon para auditoria (escolhida).** Claude Code
   e CI exportam OTLP direto para o Grafana Cloud (free tier: Prometheus/Mimir + Loki + alertas);
   painel e alarme do teto ficam lá; um job diário agrega e grava no Neon, que guarda o histórico
   além da retenção curta do free tier. Stack de mercado, pouco código nosso, CI alcança.
2. **Neon como fonte única** com receptor OTLP nosso em Node gravando no Postgres (não há exporter
   oficial para Postgres) e Grafana local lendo do Neon. Uma fonte só e aprendizado do OTLP por
   dentro, mas código nosso para manter e Grafana local para subir.
3. **Relatório local por script** lendo os `.jsonl` do Claude Code. Zero infraestrutura, mas sem
   alarme ativo, sem CI centralizado e menos aprendizado.
4. Descartadas: stack local `otel-lgtm` + cópia no Neon (dois armazenamentos, CI de fora); hook de
   fim de sessão gravando no git (dado pessoal no repositório, ruído de commit, conflita com o
   ADR-022).

O mantenedor escolheu a **1**.

## 4. Componentes

### 4.1 Configuração — `ai-observabilidade.config.json` (raiz, versionado)

Feature toggle da parte A. **Ausente ou `"ativo": false` = nada roda** (scripts saem 0 com aviso,
workflows pulam). Sem segredos.

```json
{
  "ativo": true,
  "projeto": "claude-clean-starter",
  "central": true,
  "teto": { "mensalUsd": 400, "avisoPct": 80, "porProjetoUsd": {} }
}
```

- **`projeto` é o ID canônico** do projeto em todo lugar: atributo OTEL local, atributo OTEL do
  CI, linhas do Neon e chaves de `porProjetoUsd`. Nada deriva do diretório nem do nome do repo.
- **Papéis — um hub central, vários emissores.** Os 5 projetos exportam para **uma** stack Grafana
  Cloud e **um** Neon. Só o repositório com `"central": true` (este template, na instalação do
  mantenedor) é o **hub**: dono do `teto` (total e `porProjetoUsd` de todos), único que gera e
  aplica as regras de alerta (`--grafana`) e único que roda o job diário. Nos emissores
  (`central` ausente/falso), `teto` é ignorado, `--grafana` e o job saem 0 com aviso.
- `teto.mensalUsd` é o **teto total** dos projetos; valor inicial **400**. `porProjetoUsd` é
  opcional (`{ "AssistBru.ai": 100 }`).
- Validado por **Zod** num schema único, usado pelos scripts e testes.
- No template versionado nasce com `"ativo": false` e sem `central`; o mantenedor liga pelo
  runbook. Entra no manifesto do sync como **semeado sem sobrescrever** (cada projeto tem o seu
  `projeto`); `"central": true` nunca chega a um derivado pelo sync.

### 4.2 Inventário — `npm run ai-bom` → `ai-bom.cdx.json`

Script `scripts/ai-bom/` gera um BOM **CycloneDX 1.6 JSON** a partir do repositório:

| Componente           | Fonte                                                                                 | Tipo CycloneDX                   |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------- |
| Plugins habilitados  | `.claude/settings.json` → `enabledPlugins`                                            | `application` (nome@marketplace) |
| Skills do projeto    | `.claude/skills/*/SKILL.md` (frontmatter `name`, `description`)                       | `application`                    |
| Hooks do Claude Code | `.claude/settings.json` → `hooks` (evento, matcher, comando)                          | `application`                    |
| Actions com IA       | `.github/workflows/*.yml` com `anthropics/*` (nome, SHA fixado, versão do comentário) | `application` + `pedigree`/hash  |
| Modelos declarados   | defaults de modelo nos workflows (ex.: `SPEC_GATE_MODEL` → `claude-sonnet-5-5`)       | `machine-learning-model`         |
| Serviços externos    | Anthropic API, Grafana Cloud, Neon (quando `ativo`)                                   | `services`                       |

- Saída **determinística** (ordenada, sem timestamp no corpo; `serialNumber` derivado do conteúdo)
  para o `--check` funcionar.
- `npm run ai-bom -- --check` falha (exit 1) se o arquivo versionado diverge do gerado; entra no
  `ci.yml` ao lado do `check:runbooks`. Roda **mesmo com `ativo: false`** (o inventário vale sem
  telemetria).
- **Nos derivados**: `ai-bom.cdx.json` é do projeto (vai para `ignore` no manifesto, nunca é
  copiado do template). Se o arquivo **não existe**, `--check` só avisa e sai 0, para o sync não
  quebrar o CI de quem ainda não gerou; a skill `template-sync` ganha o passo "rodar
  `npm run ai-bom` e commitar" após o sync. Se existe e diverge, falha.
- Nunca lê `.claude/settings.local.json` nem configuração pessoal (ADR-022).

### 4.3 Telemetria local (Claude Code → Grafana Cloud)

Runbook `docs/runbooks/ai-observabilidade-habilitar.md` (classe de risco conforme ADR-013) ensina:

- criar a stack Grafana Cloud (free) e o token OTLP;
- definir as variáveis de telemetria do Claude Code **na configuração pessoal** (`~/.claude/settings.json`
  `env` ou perfil do shell): `CLAUDE_CODE_ENABLE_TELEMETRY=1`, exporters de métricas e logs `otlp`,
  endpoint, headers de auth e `OTEL_RESOURCE_ATTRIBUTES` com `projeto=<nome>`; prompts desligados;
- como separar projetos: `npm run ai-bom -- --env` lê o `projeto` do config e imprime as linhas
  `export …` (sem segredos; o token vem de variável pessoal já definida) para colar ou usar no
  `direnv`;
- criar o projeto Neon `ai-observabilidade`, aplicar a migração de `observabilidade/neon/` pelo
  padrão do [ADR-008](../../adr/template/008-migracoes-sql-versionadas-driver-http.md) e cadastrar
  os secrets do hub — seção própria do mesmo runbook, passos `[R2]` (recurso novo + segredo);
- validar: abrir uma sessão e ver a métrica de custo no Grafana em até 5 min.

> Nomes de variáveis e métricas (`claude_code.cost.usage`, `claude_code.token.usage`, atributos
> `model`, `type`, `session.id`) **conferidos na documentação oficial** na implementação (ADR-022:
> flags mudam entre versões).

### 4.4 Telemetria do CI (`spec-gate.yml`)

- O passo da `claude-code-action` recebe as mesmas variáveis OTEL via `env`/`settings`, com
  `projeto=<projeto do config>` e `origem=ci`, segredos `GRAFANA_OTLP_ENDPOINT`/`GRAFANA_OTLP_TOKEN`.
- Independente do Grafana, `scripts/spec-gate.mjs report` lê o `execution_file` da action e
  publica no **resumo do job** os tokens e o custo do PR.
- **Fallback (decisão do builder conferida na implementação)**: se a versão fixada da action não
  repassar OTEL, o CI fica fora do Grafana nesta entrega e o resumo do job vale como registro; se o
  `execution_file` não trouxer custo, publica só tokens. Fica anotado como `parcial` no PR.
- Se os segredos não existirem, segue como hoje (sem falhar).

### 4.5 Painel e alarme (Grafana Cloud)

Versionados em `observabilidade/grafana/` e aplicados pelo runbook (import manual ou API):

- **Painel**: custo do mês (total e por projeto) × teto; tokens por modelo e tipo
  (entrada/saída/cache); custo por origem (local/CI) e por dia. Sessões do mês contadas no **Loki**
  (eventos), nunca com `session.id` como label do Prometheus (cardinalidade do free tier); o
  runbook manda excluir `session.id` dos atributos de métrica, se a versão do Claude Code permitir.
- **Alertas** (contato e-mail):
  - aviso quando custo acumulado no mês ≥ `avisoPct`% do teto;
  - alarme quando ≥ 100%;
  - idem por projeto, se `porProjetoUsd` definido.
- Os limiares vêm do `ai-observabilidade.config.json`: `npm run ai-bom -- --grafana` gera o JSON
  das regras a partir dele (fonte única do teto).

### 4.6 Histórico de auditoria (Neon)

- Projeto Neon dedicado `ai-observabilidade` (separado dos bancos de produto).
- Workflow agendado `ai-consumo-diario.yml` (cron diário + `workflow_dispatch`). Chega aos
  derivados pelo sync, mas **só faz algo no hub**: o primeiro passo lê o config e sai 0 se
  `central` não for `true` (nem `ativo`). Consulta a API do Grafana (PromQL para tokens e custo;
  LogQL para sessões) do dia anterior e grava em `consumo_diario`. Idempotente (`upsert`).
- Segredos: `GRAFANA_READ_TOKEN`, `AI_OBS_DATABASE_URL`.
- Migração SQL versionada em `observabilidade/neon/`.

## 5. Regras de Negócio

- **Toggle**: `ativo` ausente/falso → scripts de telemetria e workflows não fazem nada e saem 0.
- **Teto**: aviso em `avisoPct`% (padrão 80), alarme em 100%, mês civil em UTC; o custo é a
  **estimativa** do Claude Code (não a fatura).
- **Privacidade**: só números, modelo, sessão, projeto e origem; nunca prompt, resposta, caminho
  de arquivo ou usuário.
- **Idempotência**: rodar o job diário duas vezes no mesmo dia não duplica linhas.
- **Fail-open**: falha de telemetria ou do Grafana nunca quebra sessão, CI ou PR; o job diário falha
  visível (vermelho) mas não bloqueia nada.
- **Retenção**: `consumo_diario` é permanente (auditoria); não há tabela de eventos brutos nesta
  parte.
- **Hub único**: só `central: true` gera alertas e roda o job; emissores só exportam.

## 6. Dados / Queries

```sql
create table consumo_diario (
  dia date not null,
  projeto text not null,
  origem text not null check (origem in ('local', 'ci')),
  modelo text not null,
  tokens_entrada bigint not null default 0,
  tokens_saida bigint not null default 0,
  tokens_cache_leitura bigint not null default 0,
  tokens_cache_escrita bigint not null default 0,
  custo_usd numeric(12, 4) not null default 0,
  sessoes integer not null default 0,
  coletado_em timestamptz not null default now(),
  primary key (dia, projeto, origem, modelo)
);
```

Consulta de auditoria típica: custo por projeto no mês; comparação com o teto vigente.

## 7. Requisitos não funcionais

Feature de tooling, sem tela nem rota de produto: o baseline do `docs/rnf.md` não se aplica.

- RNF-SEG: nenhum segredo nem dado de uso versionado; segredos só em secrets do GitHub e config
  pessoal.
- RNF-DEP: sem dependências novas de runtime além de um cliente Postgres no job diário (preferir o
  `@neondatabase/serverless` se já usado nos exemplos; senão `pg`) e, se precisar, um validador de
  CycloneDX só em dev.
- `ai-bom` roda em < 5 s.

## 8. Cenários de teste

Feature só de tooling (scripts e workflows): sem `@e2e` nem `@usabilidade`. Testes em Vitest
(`tests/unit/`), tipo `@sistemico`, fora do `check:cenarios` (não há Playwright).

### CT-AIBOM-001 — Gerar o inventário

Tipo: @sistemico Destino: @regressao
Critério: CA-1 Perfil: time interno

Dado um repositório com 3 plugins habilitados, 2 skills, 2 hooks e o `spec-gate.yml` com a action fixada por SHA
Quando rodo `npm run ai-bom`
Então o `ai-bom.cdx.json` é CycloneDX 1.6 válido
E lista os 3 plugins, as 2 skills, os 2 hooks, a action com o SHA e o modelo "claude-sonnet-5-5"

### CT-AIBOM-002 — Inventário desatualizado barra o CI

Tipo: @sistemico Destino: @regressao
Critério: CA-1 Perfil: time interno

Dado que habilitei um plugin novo e não regenerei o inventário
Quando rodo `npm run ai-bom -- --check`
Então o comando sai com erro e diz para rodar `npm run ai-bom`

### CT-AIBOM-003 — Saída determinística

Tipo: @sistemico Destino: @regressao
Critério: CA-1 Perfil: time interno

Dado o mesmo repositório
Quando rodo `npm run ai-bom` duas vezes
Então os dois arquivos são idênticos

### CT-AIBOM-004 — Configuração pessoal fica fora

Tipo: @sistemico Destino: @regressao
Critério: CA-1 Perfil: time interno

Dado um `.claude/settings.local.json` com `model` e um plugin pessoal
Quando rodo `npm run ai-bom`
Então nada do `settings.local.json` aparece no inventário

### CT-AIBOM-005 — Configuração inválida

Tipo: @sistemico Destino: @regressao
Critério: CA-2 Perfil: time interno

Dado um `ai-observabilidade.config.json` com `"mensalUsd": -10`
Quando rodo qualquer comando do `ai-bom`
Então ele sai com erro dizendo que o teto deve ser positivo

### CT-AIBOM-006 — Feature desligada não faz nada

Tipo: @sistemico Destino: @regressao
Critério: CA-2 Perfil: time interno

Dado que o `ai-observabilidade.config.json` não existe, ou existe com `"ativo": true` sem `"central": true`
Quando o job diário e o `--grafana` rodam
Então ambos saem sem erro e sem chamar Grafana nem Neon
Mas o `npm run ai-bom` continua gerando o inventário

### CT-AIBOM-011 — Derivado sem inventário não quebra o CI

Tipo: @sistemico Destino: @regressao
Critério: CA-1 Perfil: time interno

Dado um projeto derivado que acabou de receber o sync e ainda não tem `ai-bom.cdx.json`
Quando rodo `npm run ai-bom -- --check`
Então o comando avisa para rodar `npm run ai-bom` e sai sem erro

### CT-AIBOM-007 — Limiares do alarme vêm do teto

Tipo: @sistemico Destino: @regressao
Critério: CA-4 Perfil: time interno

Dado o teto mensal "400" com aviso em "80"%
Quando rodo `npm run ai-bom -- --grafana`
Então as regras geradas disparam aviso em 320 USD e alarme em 400 USD no mês civil

### CT-AIBOM-008 — Resumo diário idempotente

Tipo: @sistemico Destino: @regressao
Critério: CA-5 Perfil: time interno

Dado uma resposta do Grafana com custo de "AssistBru.ai" em "claude-opus-5-5" no dia anterior
Quando o job diário roda duas vezes
Então há uma única linha desse dia, projeto, origem e modelo em `consumo_diario`

### CT-AIBOM-009 — Uso do gate no resumo do PR

Tipo: @sistemico Destino: @regressao
Critério: CA-3 Perfil: time interno

Dado um `execution_file` da action com tokens e custo
Quando o `spec-gate.mjs report` roda
Então o resumo do job mostra tokens de entrada, saída e o custo do PR
E sem `execution_file` o relatório sai como hoje, sem erro

### CT-AIBOM-010 — Variáveis do projeto para a sessão local

Tipo: @sistemico Destino: @regressao
Critério: CA-3 Perfil: time interno

Dado o projeto "ContasMes.ai" ativo
Quando rodo `npm run ai-bom -- --env`
Então recebo as linhas de ambiente com `projeto=ContasMes.ai` e prompts desligados
E nenhum segredo é impresso

## 9. Critérios de Aceitação

- **CA-1**: `npm run ai-bom` gera `ai-bom.cdx.json` (CycloneDX 1.6) com plugins, skills, hooks,
  actions com IA e modelos; `--check` roda no `ci.yml`; arquivo versionado está em dia.
- **CA-2**: `ai-observabilidade.config.json` validado por Zod; ausente/`ativo: false` desliga
  telemetria, alarme e job sem quebrar nada; só o hub (`central: true`) gera alertas e roda o job;
  no template versionado nasce desligado; sync semeia o config sem sobrescrever e ignora o
  `ai-bom.cdx.json`.
- **CA-3**: sessões locais e o gate de CI aparecem no Grafana Cloud por projeto e origem
  (verificação manual do runbook); o gate publica tokens e custo no resumo do job.
- **CA-4**: painel e regras de alerta versionados; aviso a 80% e alarme a 100% do teto de US$ 400;
  limiares derivados do config.
- **CA-5**: job diário grava `consumo_diario` no Neon `ai-observabilidade`, idempotente.
- **CA-6**: ADR-023 registra a decisão; runbook `ai-observabilidade-habilitar.md` passa no
  `check:runbooks`; `SKILLS.md`/`CLAUDE.md` com um ponteiro; manifesto do sync atualizado.
- **CA-7**: `npm run lint`, `type-check`, `test` e `format` ok.

## 10. Itens Futuros

- **Parte B**: gateway único de chamadas a LLM no produto (contagem, limite por usuário/tenant,
  auditoria) e contagem de chamadas às tools MCP, reaproveitando OTel e o Neon.
- Bloqueio suave ao atingir o teto (hook que avisa no início da sessão).
- Importar o histórico dos `.jsonl` locais.
- Teto em tokens ou por janela do plano do Claude, além de USD.
