# Runbooks

Procedimentos de **operação** (deploy, configuração de ambientes, segredos, flags,
migrações, MCP, rollback) escritos para serem executados **por agentes** — e por humanos —
passo a passo, com classe de risco e verificação em cada passo. Regras em
[ADR-013](../adr/template/013-governanca-operacional-e-runbooks.md).

> Este é o catálogo do **template**: os comandos assumem Neon + Auth0 e o host do
> `deploy.config.json` (`vercel` — o padrão sem o arquivo —, `heroku` ou `cloudrun`). Os runbooks
> gerais são neutros e chamam o bloco do runbook do host (`host-<host>.md`); os valores do projeto estão como `<preencher: …>` (entradas, decididas pelo
> humano) ou `<gerado: …>` (saídas do `bootstrap-ambientes.md`, gravadas por ele via PR).
> Ao adotar, complete-os (checklist abaixo).

## Catálogo

| Runbook                                                              | Quando usar                                                                                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [bootstrap-ambientes.md](./bootstrap-ambientes.md)                   | Uma vez por projeto: host (bloco **Bootstrap** do `host-<host>.md`), Neon, Auth0, envs, UAT fixo, proteção da `main`                                |
| [deploy-uat.md](./deploy-uat.md)                                     | Levar uma branch ao UAT (push + PR → preview) e fazer o smoke test                                                                                  |
| [deploy-prod.md](./deploy-prod.md)                                   | Promover um PR aprovado no UAT para Prod (o **merge é do humano**)                                                                                  |
| [rollback.md](./rollback.md)                                         | Incidente: desligar flag, promover deploy anterior, revert por PR                                                                                   |
| [promover-prod.md](./promover-prod.md)                               | **Esteira** (ADR-020): levar o pacote do UAT para Prod e avançar a `main` por FF (o **disparo é do humano**)                                        |
| [hotfix.md](./hotfix.md)                                             | **Esteira** (ADR-021): `hotfix/*` direto na `main`, deploy de Prod e back-promotion para a `develop`                                                |
| [esteira-github-app.md](./esteira-github-app.md)                     | **Esteira**: criar/instalar a GitHub App `esteira-promover`, segredos, bypass da `main`, rotacionar a chave                                         |
| [adotar-esteira-develop.md](./adotar-esteira-develop.md)             | **Opcional** (esteira, ADR-020): criar a `develop`, preparar host/App/repo e ligar o bloco `esteira` por PR                                         |
| [migracao-banco.md](./migracao-banco.md)                             | Aplicar migração SQL (ADR-008) em preview/UAT/Prod                                                                                                  |
| [segredos-e-env.md](./segredos-e-env.md)                             | Criar/alterar env não-secreta; criar/rotacionar segredo                                                                                             |
| [feature-flags.md](./feature-flags.md)                               | Ligar/desligar flags por ambiente (incl. kill switch e escrita MCP)                                                                                 |
| [mcp-habilitar-e-conectar.md](./mcp-habilitar-e-conectar.md)         | Configurar Auth0 para o MCP e conectar o ChatGPT                                                                                                    |
| [spec-gate.md](./spec-gate.md)                                       | Ligar/desligar o gate opcional `Spec × código` com Claude (`SPEC_GATE`, `ANTHROPIC_API_KEY`)                                                        |
| [e2e-uat-configurar.md](./e2e-uat-configurar.md)                     | **Opcional** (só com `E2E_TARGET=preview`): usuários de teste, PATs e segredos para a `Regressão (UAT)` rodar contra o Preview                      |
| [bunny-habilitar.md](./bunny-habilitar.md)                           | **Opcional** (`DEMOS_BUNNY`): library, storage zone, segredos `BUNNY_*` e envs para os vídeos de demo/treinamento na `/ajuda`                       |
| [ai-observabilidade-habilitar.md](./ai-observabilidade-habilitar.md) | **Opcional** (ADR-023): Grafana Cloud, variáveis da sessão, segredos do CI e, no hub, Neon `ai-observabilidade` para a telemetria de tokens e custo |
| [host-vercel.md](./host-vercel.md)                                   | Blocos do host **Vercel** (padrão): Bootstrap, UAT (alias), Prod, Rollback, Segredos e envs, Cron, Encerrar                                         |
| [host-heroku.md](./host-heroku.md)                                   | Blocos do host **Heroku** (pipeline, review apps, UAT fixo por slug, Auth0 por Management API)                                                      |
| [host-cloudrun.md](./host-cloudrun.md)                               | Blocos do host **Cloud Run** (projetos GCP, WIF, revisões com tag `pr-<n>`/`uat`, tráfego em Prod)                                                  |
| [migrar-host.md](./migrar-host.md)                                   | Trocar o host do projeto (Vercel ↔ Heroku ↔ Cloud Run) em paralelo, com corte de DNS                                                                |
| [uso-mcp-habilitar.md](./uso-mcp-habilitar.md)                       | **Opcional** (`USO_MCP_OBSERVABILIDADE`, ADR-024): tabela `mcp_uso_diario`, OTLP e flag para medir o uso das tools MCP                              |

## Classes de risco (resumo)

| Classe                                                  | Gate                                        |
| ------------------------------------------------------- | ------------------------------------------- |
| `[R0]` leitura                                          | livre                                       |
| `[R1]` mutação reversível fora de Prod                  | agente executa e registra                   |
| `[R2]` Prod, segredo, destrutivo, escrita MCP           | aprovação humana explícita **por operação** |
| `[R3]` merge na `main`, ler segredo, desligar proteções | proibido ao agente — `[R3] Humano: …`       |

R1 contra Prod vira R2; runbook com `Última verificação` > 90 dias eleva todo passo não-R0 a
R2; na dúvida, vale a classe mais alta.

## Como executar

Peça ao agente a operação ("faça o deploy em UAT", "ligue a escrita MCP no UAT"). Ele usa a
skill `runbook-execution`: localiza o runbook nesta tabela, recusa se houver `<preencher` (ou `<gerado`, fora do bootstrap),
roda o pre-flight, aplica o gate de cada passo, verifica, faz rollback em falha e registra
a execução no PR (ou numa issue `ops`). Sem runbook para a operação, ele não executa —
propõe um.

## Como criar um runbook

1. Copie [`_TEMPLATE.md`](./_TEMPLATE.md) para `docs/runbooks/<operacao>.md`.
2. Preencha metadados, seções e passos (classe + `Verificar:` em cada um).
3. Adicione uma linha na tabela do catálogo acima.
4. `npm run check:runbooks` e abra o PR.

## Validação

`npm run check:runbooks` valida o formato de todo runbook e a presença do catálogo
obrigatório (roda no CI). `npm run check:runbooks -- --strict` também exige zero
`<preencher`/`<gerado` e `Última verificação` em data ISO válida — é o modo do projeto adotado.

## Checklist de adoção

- [ ] Preencher todo `<preencher>` dos runbooks (conta/projeto do host, org Neon, URLs,
      responsáveis), executar o `bootstrap-ambientes.md` (que grava os `<gerado>`: id do
      projeto Neon, tenants Auth0) e datar `Última verificação`.
- [ ] Trocar o passo do CI para `npm run check:runbooks -- --strict`.
- [ ] Adicionar um runbook para cada operação recorrente nova do projeto.

> O `e2e-uat-configurar.md` é **opcional**: só se o projeto ligar `E2E_TARGET=preview` (sem ele,
> a `Regressão (UAT)` roda contra o app local do runner). Não vai usar o modo preview? Apague o
> runbook e a linha do catálogo, para o `--strict` não cobrar os `<preencher>` dele.
