# 024. Medição de uso das tools MCP no `callTool`

**Data**: 2026-11-28
**Status**: Aceito

## Contexto

Os produtos derivados são consumidos por LLMs de terceiros via MCP ([ADR-012](./012-mcp-como-borda-agentica.md)).
**Quem paga os tokens é o usuário do produto**, pelo próprio cliente de LLM e dentro da cota do plano
dele; o produto não gasta tokens por conta própria. Ainda assim o produto decide quanto cada resposta
de tool custa ao usuário: uma tool que devolve 20 mil tokens consome a cota sem ele perceber. O
BEST_PRACTICES pede saída pequena e paginada, mas nada media se isso é cumprido.

Nenhum projeto derivado chama um modelo com chave própria, então um gateway de saída para LLM (limite
de gasto por tenant) não tem consumidor hoje. A medição de consumo do Claude Code no desenvolvimento é
outra frente (ADR-023, PR #26, quando mergeada).

## Decisão

**Medir cada chamada de tool MCP em um único ponto, o `callTool`, por um `IUsageMeter` injetado**, no
mesmo molde de `IAuditLog` e `IRateLimiter`:

- Registra `{ at, tenantId, tool, outcome, code?, latencyMs, outputTokensEst }`. **Nunca** argumentos,
  conteúdo da resposta nem id do ator. Tokens são **estimados** (caracteres ÷ 4) sobre o `text` da
  resposta; o produto não enxerga os tokens reais do cliente.
- Atrás da flag `observabilidade.uso-mcp` (`USO_MCP_OBSERVABILIDADE`), **desligada por padrão**,
  avaliada a cada chamada (kill switch em tempo de execução).
- **Fail-open e com timeout** (500 ms, `usageTimeoutMs`): falha ou lentidão do medidor é logada e
  nunca altera a resposta da tool. Tool inexistente não é medida (o nome vem do cliente).
- Dois destinos: **OTel** (métricas por tool; rótulos só `tool` e `resultado`, **tenant nunca é
  rótulo**) para a visão operacional, e a **tabela diária `mcp_uso_diario`** no Neon (por dia, tenant e
  tool) para auditoria. O skeleton traz o medidor OTel e um em memória; o `PostgresUsageMeter` é do
  projeto real, como as demais implementações com banco.
- Sem tool MCP nem rota REST de consulta: o uso é do dono do produto (Grafana e SQL).

## Consequências

- Fica fácil achar tools pesadas, auditar o uso por tenant e provar o que o produto faz o usuário
  gastar. O custo é uma escrita no Neon por chamada (aceitável: as tools já fazem I/O; um buffer em
  memória se perderia em serverless).
- A estimativa é grosseira (não é tokenizer). Serve para comparar tools e acompanhar tendência.
- Dívidas assumidas: o usuário final não vê o próprio uso; não há alerta nem teto por tokens.

## Alternativas Consideradas

- **Só OTel/Grafana:** sem histórico longo nem por tenant; não atende a auditoria.
- **Estender o `IAuditLog` com leituras:** mistura auditoria append-only de escritas com métrica e
  cria uma linha por leitura.
- **Gateway de saída para LLM com limite por tenant:** sem consumidor hoje (YAGNI); reabre se um
  projeto passar a chamar um modelo com chave própria.
