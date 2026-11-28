# Runbook: Habilitar a observabilidade de consumo de IA (AI-BOM e Grafana)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

## Objetivo

Ligar a telemetria de tokens e custo do Claude Code e do gate Spec × código
([ADR-023](../adr/template/023-ai-bom-e-observabilidade-de-consumo.md)): stack Grafana Cloud com
painel e alertas de teto, variáveis pessoais da sessão local, segredos do CI e, no projeto **hub**,
o projeto Neon `ai-observabilidade` com o resumo diário de auditoria. Use uma vez por projeto
emissor, uma vez para o hub, e de novo ao rotacionar qualquer credencial.

> **Opcional**: com `ativo: false` (padrão) em `ai-observabilidade.config.json`, nada é exportado
> e os workflows saem verdes sem fazer nada.

> **Segredos (ADR-013 §4)**: tokens e senhas são digitados **pelo humano, num terminal separado,
> fora da sessão do agente** (ou no dashboard). O agente nunca vê, ecoa ou passa valor em
> argumento, nem cola valor no chat; só confere **nomes**.

> **Credenciais separadas**: a credencial OTLP usada no CI é **só de ingestão** (escrita de métricas
> e logs), porque os scripts do spec-gate rodam do head do PR. A de **leitura** (job diário) é
> outra credencial, somente leitura, e só existe no hub.

## Pré-condições

- Conta Grafana Cloud (free) e acesso de admin à stack: `<preencher: conta/stack Grafana Cloud>`.
- Humano com admin no repositório; para o hub, conta Neon com permissão de criar projeto.
- `ai-observabilidade.config.json` com `projeto` e o teto (`teto.mensalUsd`, `avisoPct`,
  `porProjetoUsd`); o hub (um só, `<preencher: projeto hub>`) tem também `"central": true`.
- Só o hub gera as regras de alerta e roda o job diário; os demais são emissores.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Ver o estado: `gh secret list --repo <preencher: owner/repo>` (só nomes) e `npm run ai-bom -- --check`; o config deve estar válido.

## Passos

1. [R2] Criar a stack Grafana Cloud `<preencher: nome da stack>` e um **contato de alerta por e-mail** (`<preencher: e-mail do contato>`); criar a credencial **OTLP de ingestão** (somente escrita de métricas e logs) e anotar endpoint e instance id. O humano guarda o token fora da sessão.
   Verificar: o humano confirma no painel a stack, o contato e a credencial com escopo só de escrita.
2. [R1] Ligar a feature **localmente** (sem commitar ainda): em `ai-observabilidade.config.json` pôr `"ativo": true` (e `"central": true` **só no hub**). Sem isso o config semeado (`ativo: false`) faz `--env` e `--grafana` não imprimirem nada.
   Verificar: `npm run ai-bom -- --check` não acusa config inválido.
3. [R1] Gerar as variáveis pessoais da sessão local: `npm run ai-bom -- --env`. Colar as linhas `export …` no perfil do shell (ou `direnv`) e definir **na configuração pessoal**, digitando o valor fora da sessão, `GRAFANA_OTLP_ENDPOINT` e `GRAFANA_OTLP_HEADERS` (formato `Authorization=Basic <base64 de instance:token>`). Nada disso vai para o `.claude/settings.json` do time (ADR-022).
   Verificar: `npm run ai-bom -- --env` imprime `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_RESOURCE_ATTRIBUTES` com `projeto=<projeto>,origem=local` e `OTEL_METRICS_INCLUDE_SESSION_ID=false`, e **nenhum** segredo (só as referências `${GRAFANA_OTLP_*}`).
4. [R2] Gravar os segredos do CI do emissor: para cada nome, o humano roda `gh secret set <NOME> --repo <preencher: owner/repo>` num terminal separado e digita o valor no prompt: `GRAFANA_OTLP_ENDPOINT` e `GRAFANA_OTLP_HEADERS` (valor completo `Authorization=Basic <base64>`, credencial **só de ingestão**).
   Verificar: `gh secret list --repo <preencher: owner/repo>` lista os dois **nomes** (o valor nunca aparece).
5. [R2] **Só no hub**: criar o projeto Neon `ai-observabilidade` (`<preencher: org Neon>`), aplicar `observabilidade/neon/001-consumo-diario.sql` pelo padrão do [migracao-banco.md](./migracao-banco.md) (ADR-008, driver HTTP) e cadastrar os segredos: `AI_OBS_DATABASE_URL`, `GRAFANA_API_URL` e `GRAFANA_READ_TOKEN` (credencial **só de leitura**, separada da de ingestão), todos digitados pelo humano via `gh secret set`.
   Verificar: o humano roda no SQL editor do Neon `select count(*) from consumo_diario` → `0`; `gh secret list --repo <preencher: owner/repo>` lista os três **nomes**.
6. [R0] Conferir as métricas reais no Grafana (Explore, datasource Prometheus) depois de uma sessão com telemetria: `claude_code_cost_usage_USD_total`, `claude_code_token_usage_tokens_total` e `claude_code_session_count_total`, com os labels `projeto`, `origem`, `model` e `type`. Se os nomes ou labels diferirem, as constantes de `scripts/ai-observabilidade/metricas.mjs` são o **único** lugar a mudar (painel e regras partem delas; ajuste o `painel.json` junto).
   Verificar: as três séries aparecem com os labels esperados.
7. [R0] Confirmar o esquema de autenticação de `GRAFANA_API_URL` (só no hub). O código envia `Authorization: Bearer <GRAFANA_READ_TOKEN>` e consulta `<GRAFANA_API_URL>/api/v1/query`, o que serve a URL da stack Grafana + token de service account apontando para o proxy do datasource Prometheus (ex.: `https://<stack>.grafana.net/api/datasources/proxy/uid/<uid-do-prometheus>`). O endpoint Prometheus hospedado usa Basic auth `instance:token`; nesse caso, ou aponte `GRAFANA_API_URL` para o proxy, ou adapte `criarConsultar` em `scripts/ai-observabilidade/consumoDiario.mjs`.
   Verificar: o humano testa a URL escolhida com o token (fora da sessão) e recebe `status: success` em `/api/v1/query?query=up`.
8. [R1] Importar o painel: no Grafana, Dashboards > Import com `observabilidade/grafana/painel.json`; o placeholder `${DS_PROMETHEUS}` é pedido na importação e substituído pelo uid do datasource Prometheus.
   Verificar: o painel abre e os gráficos de custo, tokens, origem e sessões mostram dados (ou "sem dados" antes da primeira sessão), sem erro de datasource.
9. [R1] **Só no hub** (`central: true`): gerar as regras de alerta com `npm run ai-bom -- --grafana > <preencher: arquivo temporário>`. A saída está no formato de _file provisioning_ de regras do Grafana (`apiVersion: 1`, `groups`), que o Grafana Cloud não lê de arquivo: aplique-a pela API de provisioning de alertas do Grafana (`POST /api/v1/provisioning/alert-rules`, uma chamada por regra, convertendo cada item de `groups[].rules[]`, com `folderUID`, `ruleGroup` e `orgID`), ou recrie as regras pela UI (Alerting > Alert rules > New) a partir do JSON. Conferir a rota e o corpo na documentação da versão da sua stack; este runbook não os fixa. Em qualquer caminho, substitua `${DS_PROMETHEUS}` pelo uid do datasource Prometheus e associe o contato de e-mail do passo 1. O `uid` de cada regra é `teto-total-aviso`/`-alarme` e `teto-<projeto>-aviso`/`-alarme` (o nome cru da chave de `porProjetoUsd`) e só aceita `[A-Za-z0-9_-]`, até 40 caracteres (nome do projeto com até 28). Nomes com `.` (ex.: `AssistBru.ai`) ou espaço geram uid inválido. A chave de `porProjetoUsd` também é o filtro `projeto="…"` do PromQL, então **não** a renomeie só no alerta: ou renomeie o projeto de forma consistente (`projeto` no config, `OTEL_RESOURCE_ATTRIBUTES` e a chave de `porProjetoUsd`, tudo igual e sem `.` nem espaço), ou não use `porProjetoUsd` para esse projeto e confie no alerta total e na auditoria do Neon. O alerta usa janela móvel de 30 dias (aproximação do mês civil); o mês civil exato está no Neon.
   Verificar: as regras `teto-total-aviso` e `teto-total-alarme` (e uma dupla por projeto em `porProjetoUsd`) aparecem em Alerting, pasta `ai-observabilidade`, sem erro de avaliação.
10. [R1] Abrir o PR com o config ligado: rodar `npm run ai-bom` e commitar `ai-observabilidade.config.json` e `ai-bom.cdx.json` (o merge é do humano).
    Verificar: `npm run ai-bom -- --check` → "em dia"; `npm run ai-bom -- --env` imprime as variáveis.

> A retenção do Loki no free tier é menor que 30 dias; não é problema, porque a auditoria de longo
> prazo vive no Neon (`consumo_diario`).

## Verificação final

- Abrir uma sessão do Claude Code com as variáveis do passo 3: o custo da sessão aparece no painel em até 5 min (`claude_code_cost_usage_USD_total` com `projeto` e `origem=local`).
- Num PR com `SPEC_GATE` ligado e os segredos do passo 4, o job do gate exporta com `origem=ci` e o resumo do job traz tokens e custo do PR.
- No hub: `gh workflow run ai-consumo-diario.yml --repo <preencher: owner/repo>` e acompanhar com `gh run watch` (verde); no Neon, `select * from consumo_diario order by dia desc limit 5` mostra ao menos 1 linha do dia anterior (sessões na linha com `modelo='*'`).

## Rollback

1. [R1] Desligar a feature: `"ativo": false` em `ai-observabilidade.config.json` por PR; as sessões deixam de receber as variáveis (`--env`) e o CI e o job diário saem 0.
   Verificar: `npm run ai-bom -- --env` avisa "observabilidade desligada".
2. [R2] Remover segredos que não serão mais usados: `gh secret delete <NOME> --repo <preencher: owner/repo>` (um por aprovação); o humano revoga as credenciais no Grafana e, se encerrar o hub, remove o projeto Neon.
   Verificar: `gh secret list --repo <preencher: owner/repo>` não lista mais os nomes removidos.

> Dados já enviados ao Grafana e gravados no Neon permanecem até serem apagados pelos painéis.

## Registro

Comentário no PR ou issue `ops`: runbook + `Última verificação`, **nomes** dos segredos criados,
aprovações R2, uid do datasource usado, resultado do `workflow_dispatch` e do custo visto no
painel. Nunca valores.
