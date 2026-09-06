# 010. Rate-limit de rotas públicas em tabela Postgres (não Redis)

**Data**: 2026-09-06
**Status**: Aceito

## Contexto

Rotas públicas **não autenticadas** — tipicamente `login` e `signup` — são a
superfície natural de brute-force e criação de contas em massa. Elas precisam de
rate-limit por IP **antes** de tocar o provedor de identidade (Auth0, ADR-001).

A força que torna a decisão não óbvia é o ambiente de execução: o app roda
**serverless** (funções Vercel + Neon, [ADR-001](./001-neon-auth0.md)). Não há
memória compartilhada nem duradoura entre instâncias — cada invocação pode cair numa
instância diferente, e instâncias somem entre requisições. Um contador em memória de
processo (`Map`/variável de módulo) **não** limita nada de forma confiável: cada
instância conta do zero.

A solução de manual seria um Redis dedicado, mas isso adiciona um serviço, uma
credencial e um custo fixo só para um contador de janela.

## Decisão

**O estado do rate-limit vive numa tabela do Postgres (Neon), como contador de janela
fixa, atualizado por upsert atômico. Nada de Redis.**

- Tabela dedicada (ex.: `auth_rate_limits`) com chave `(escopo, janela)` e um contador.
- Um helper `rateLimit(chave, { limit, windowSec })` é chamado **no topo** do handler,
  antes de qualquer chamada ao IdP. Ele faz um `INSERT … ON CONFLICT … DO UPDATE SET
  count = count + 1` (upsert atômico) e compara com o limite — a atomicidade do
  Postgres resolve a corrida entre instâncias concorrentes.
- Ao exceder, lança um erro funcional `RateLimitedError` → **429** com header
  `Retry-After`; o `code` `RATE_LIMITED` é **funcional** (toast de aviso, não alarme —
  ver [ADR-009](./009-erros-funcional-vs-tecnico.md)).
- **Identificação do cliente**: preferir `x-real-ip` ao primeiro item de
  `x-forwarded-for` (que é facilmente forjável pelo cliente). O IP entra na `chave`.
- Limites de referência: login ~10/min, signup ~5/h — ajustáveis por rota.

## Consequências

**Fica mais fácil**
- Zero infra nova: reusa o banco que já existe; sem serviço, credencial ou custo extra.
- Correto em serverless: o estado é compartilhado e durável porque é o Postgres; o
  upsert atômico dispensa lock de aplicação.
- Coerente com a taxonomia de erro: 429 é funcional, cai no mesmo pipeline de UI.

**Fica mais difícil / dívidas assumidas**
- Cada requisição limitada custa um round-trip ao banco (aceitável no volume de rotas
  de auth; não use este padrão para limitar tráfego de alta frequência).
- Janela fixa tem o efeito de borda clássico (rajada no limite de duas janelas) — ok
  para anti-abuso de auth; se precisar de precisão, evoluir para janela deslizante.
- Limpeza: linhas de janelas antigas acumulam; prever expurgo periódico.

## Alternativas Consideradas

- **Contador em memória de processo.** Descartado: não compartilha estado entre
  instâncias serverless — não limita nada de fato.
- **Redis/Upstash dedicado.** Correto e rápido, porém adiciona serviço, credencial e
  custo fixo. Reservado para quando o volume justificar; para rotas de auth, a tabela
  Postgres basta.
- **Rate-limit só na borda (WAF/gateway).** Útil como camada extra, mas fora do
  controle do app e sem o `code` funcional integrado; não substitui o guard na rota.
</content>
