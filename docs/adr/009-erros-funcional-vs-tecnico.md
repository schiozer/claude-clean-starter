# 009. Erro funcional vs. técnico, sink central de log e `no-console` como erro

**Data**: 2026-09-06
**Status**: Aceito

## Contexto

Toda aplicação erra de duas formas fundamentalmente diferentes, e tratá-las igual
degrada tanto a UX quanto a observabilidade:

- **Erro funcional** — regra de negócio esperada (entrada inválida, não autorizado,
  não encontrado). O usuário fez algo válido; o sistema recusa por um motivo legítimo.
- **Erro técnico** — algo quebrou de verdade (exceção não prevista, falha de rede,
  bug). Não é culpa do usuário.

Sem uma distinção explícita, três problemas aparecem: (1) o log enche de "erros" que
são só validação, e o bug real se perde no ruído; (2) a UI mostra alarme vermelho de
falha para o que era só uma regra de negócio; (3) `console.error` espalhado pelo
código vira o "sink" de fato, impossível de redirecionar para observabilidade depois.

## Decisão

**A natureza do erro é decidida pelo `code` que a API devolve, há uma única fronteira
que converte erro em resposta HTTP, um único sink de log, e `console` é proibido no
app por regra de lint tratada como erro.**

1. **Contrato `{ error, code }`.** Toda resposta de erro carrega uma mensagem e um
   `code`. `code`s de negócio (`VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`,
   `UNAUTHORIZED`, …) são **funcionais**; ausência de código ou `INTERNAL_ERROR` é
   **técnico**. Os `code`s nascem fixos nas subclasses de `AppError`
   (`src/shared/errors.ts`) — nunca strings soltas.
2. **Fronteira única** (`handleApiError`, `src/shared/handleApiError.ts`). Mapeia
   `ZodError` → 400, `AppError` → seu `statusCode`/`code`, e qualquer outra coisa →
   500 `INTERNAL_ERROR`. **Só o ramo técnico (500) loga**; funcional não vira ruído.
3. **Sink central** (`logError`, `src/shared/logError.ts`). É o **único** lugar
   autorizado a chamar `console`, com um ponto pronto para plugar
   Sentry/observabilidade. Assinatura `logError(context, error, extra?)`.
4. **`no-console: 'error'` e `no-explicit-any: 'error'`** no ESLint do app, com
   override desligando ambos em `tests/**` e `scripts/**` (mocks e CLIs). Regra como
   **erro**, não warning: warning não trava o CI e regride com o tempo.
5. **No front, o `code` escolhe o visual** — funcional mostra a mensagem acionável da
   API (tom de aviso); técnico mostra "tente novamente" (tom de alarme). Melhor que
   notificar é **prevenir**: desabilite a ação quando a regra é checável no cliente.

## Consequências

**Fica mais fácil**
- Observabilidade: cada linha de log é um bug de verdade — o ruído funcional não entra.
- UX coerente: regra de negócio parece regra, falha parece falha.
- Trocar o destino de log (Sentry) mexe em um arquivo, não em N `console.error`.
- Contrato estável para o front e para clientes nativos (mesmo `code` em todo lugar).

**Fica mais difícil / dívidas assumidas**
- Disciplina: cada novo caso de negócio precisa de uma subclasse de `AppError` com
  `code` próprio, e o front precisa conhecer os `code`s funcionais.
- A regra de lint como erro exige o `eslint-disable-next-line` explícito na única
  linha de `console` legítima (dentro do sink) — intencional, para ser visível.

## Alternativas Consideradas

- **`console.error` direto + status HTTP nas rotas.** Descartado: espalha logging e
  formatação de resposta por toda rota, sem ponto único para observabilidade nem para
  a taxonomia funcional/técnico.
- **`no-console` como `warn`.** Descartado: warning não bloqueia CI, acumula e a regra
  morre. Erro força a exceção a ser consciente e única.
- **Campo `isOperational` na classe de erro** (estilo comum). Descartado por
  redundante: o `code` + o tipo (`AppError` vs. resto) já expressam "funcional vs.
  técnico" sem um booleano extra para manter em sincronia.
</content>
