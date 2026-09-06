# Guia de Tratamento de Erros

**Última Atualização**: 2026-09-06
**Versão**: 2.0.0

---

## Visão Geral

Este guia estabelece o padrão de erros do starter. Ele é **auto-contido**: todo
código citado existe em `examples/walking-skeleton/src/shared/`. Os pilares são:

- **Hierarquia enxuta** (`AppError` + subclasses) — `errors.ts`.
- **Uma fronteira única** que converte erro em resposta HTTP — `handleApiError`.
- **Um sink central de log** — `logError` (o único ponto autorizado a chamar
  `console`).
- **Taxonomia funcional vs. técnico** — decide o que loga e como a UI reage.

A decisão de fundo (por que erro funcional não vira log/500) está no
[ADR-009](../adr/009-erros-funcional-vs-tecnico.md).

---

## Hierarquia de Erros

`src/shared/errors.ts` — deliberadamente pequena. Sem `isOperational`, sem campo
`context`, sem uma classe por status. Cada erro carrega **mensagem** (técnica, para
o log), **`code`** (contrato com o front) e **`statusCode`** (HTTP).

```typescript
// src/shared/errors.ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class DomainError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} não encontrado`, 'NOT_FOUND', 404)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Não autorizado') {
    super(message, 'UNAUTHORIZED', 401)
  }
}
```

**Como estender.** Precisa de um novo caso de negócio? Crie uma subclasse que fixe
`code` e `statusCode` — nunca espalhe strings de código pelo app. Exemplo de um
`ForbiddenError` (403, funcional):

```typescript
export class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado') {
    super(message, 'FORBIDDEN', 403)
  }
}
```

**Onde lançar.** As regras vivem na entidade (`Resource.validate()` lança
`DomainError`) e no use-case/guard (`requireUser` lança `UnauthorizedError`). A UI e
a rota **não** replicam essas checagens — elas confiam na fronteira.

---

## A Fronteira: `handleApiError`

Toda API Route termina o `catch` chamando **uma** função. Ela é a única que sabe
traduzir erro em `Response`, e é a única que decide o que vai para o log.

```typescript
// src/shared/handleApiError.ts
import { ZodError } from 'zod'
import { AppError } from './errors'
import { logError } from './logError'

export function handleApiError(error: unknown, context = 'api'): Response {
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? 'Dados inválidos'
    return Response.json({ error: message, code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  if (error instanceof AppError) {
    // Erro de domínio (funcional) é esperado — não é bug, não vai para o sink.
    return Response.json({ error: error.message, code: error.code }, { status: error.statusCode })
  }
  // Só o inesperado (técnico → 500) passa pelo sink central de log.
  logError(context, error)
  return Response.json(
    { error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' },
    { status: 500 }
  )
}
```

Note o ponto-chave: **`ZodError` e `AppError` NÃO logam**. São resultados esperados
de entrada inválida ou regra de negócio — ruído se fossem para o log. Só o ramo
inesperado (o 500 genuíno) chama `logError`. Isso mantém o log limpo o bastante para
que cada linha nele seja um bug de verdade.

**Uso na rota** — sempre com um `context` que identifique a origem
(`'<área>:<método>'`), para que o log diga de onde veio:

```typescript
// src/app/api/resources/route.ts
export async function POST(req: Request): Promise<Response> {
  try {
    ensureEnabled()
    const user = requireUser(await authProvider.getUser(req))
    const dto = createResourceSchema.parse(await req.json())
    const resource = await new CreateResourceUseCase(resourceRepository).execute(dto, user.id)
    return Response.json(resource, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'api/resources:POST')
  }
}
```

---

## O Sink Central: `logError`

`console.*` é **proibido** no app pela regra ESLint `no-console: 'error'` (ver
[ADR-009](../adr/009-erros-funcional-vs-tecnico.md)). A única exceção autorizada é a
linha dentro de `logError` — o funil por onde todo erro engolido passa. Assim há um
ponto único para, no futuro, plugar Sentry/observabilidade sem caçar `console.error`
espalhados.

```typescript
// src/shared/logError.ts
import { AppError } from './errors'

export function logError(context: string, error: unknown, extra?: Record<string, unknown>): void {
  const err = error instanceof Error ? error : new Error(String(error))
  // eslint-disable-next-line no-console -- sink central de log; ver ADR-009
  console.error(`[${context}]`, {
    name: err.name,
    message: err.message,
    code: err instanceof AppError ? err.code : undefined,
    ...extra,
  })
  // TODO: encaminhar para Sentry/observabilidade aqui.
}
```

Assinatura: `logError(context, error, extra?)`. O `context` é uma string curta que
identifica a origem; `extra` carrega dados de diagnóstico estruturados.

---

## Funcional vs. Técnico

Nem todo erro é bug. Distinguir **regra de negócio** de **falha técnica** define o
que loga e como a UI reage. A distinção usa o **`code`** que a API já devolve.

- **Funcional** — regra de negócio esperada (título curto, não autorizado, não
  encontrado). O usuário fez algo válido e o sistema tem motivo legítimo para
  recusar. Mensagem **acionável**, tom acolhedor (aviso), nunca alarme vermelho.
  Não vai para o log. Códigos: `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`,
  `UNAUTHORIZED` (estenda a lista conforme o domínio).
- **Técnico** — algo quebrou (500, rede, timeout). Não é culpa do usuário. Tom de
  alerta, mensagem genérica de "tente novamente". Vai para o `logError`.

No front, o hook lê o `code` para escolher a mensagem — funcional mostra o texto da
API, técnico mostra o genérico:

```typescript
// src/presentation/hooks/useResources.ts (trecho)
const body = await res.json()
if (!res.ok) {
  setError(body.code === 'VALIDATION_ERROR' ? body.error : 'Erro. Tente novamente.')
  return false
}
```

**Melhor que notificar é prevenir.** Quando dá para checar a regra no cliente,
desabilite a ação com uma dica em vez de deixar o erro acontecer. Ver a seção
*Notificações* em [BEST_PRACTICES.md](../../BEST_PRACTICES.md).

---

## Regras de Ouro

### Nunca engula erro silenciosamente

```typescript
// ❌ RUIM: erro some
try { await risky() } catch { /* nada */ }

// ✅ BOM: técnico → sink; funcional → deixe subir para a fronteira
try {
  await risky()
} catch (err) {
  logError('modulo:operacao', err)
  throw err
}
```

### Valide na fronteira com Zod

O `parse` lança `ZodError`, que `handleApiError` já mapeia para 400. Não reimplemente
validação manual dentro do handler — deixe o schema falar.

```typescript
const dto = createResourceSchema.parse(await req.json())
```

### Um `code` por caso, definido na classe

O front decide o visual pelo `code`. Se o mesmo caso de negócio nasce com códigos
diferentes em lugares diferentes, o front não consegue classificá-lo. Fixe o `code`
na subclasse de `AppError` e reutilize.

---

## Testando o Tratamento de Erro

Teste a fronteira diretamente: erro funcional **não loga**; erro técnico **loga com
contexto**.

```typescript
// tests/unit/handleApiError.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleApiError } from '@/shared/handleApiError'
import { ValidationError } from '@/shared/errors'

afterEach(() => vi.restoreAllMocks())

describe('handleApiError', () => {
  it('mapeia AppError para status + code (funcional — não loga)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = handleApiError(new ValidationError('Título inválido'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Título inválido', code: 'VALIDATION_ERROR' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('mapeia erro desconhecido para 500 e loga no sink (técnico)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = handleApiError(new Error('boom'), 'api/resources:POST')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' })
    expect(spy).toHaveBeenCalledWith('[api/resources:POST]', expect.objectContaining({ message: 'boom' }))
  })
})
```

---

## Checklist

Antes de commitar código com tratamento de erro:

- [ ] Erros de domínio herdam de `AppError` com `code` e `statusCode` fixos
- [ ] Toda API Route termina o `catch` em `handleApiError(error, '<contexto>')`
- [ ] Validação de entrada é Zod na fronteira (deixa o `ZodError` subir)
- [ ] Nenhum `console.*` no app — só o sink `logError`
- [ ] Erro funcional não é logado; erro técnico é logado com contexto
- [ ] O front escolhe a mensagem pelo `code` (funcional vs. técnico)
- [ ] Fronteira coberta por teste (funcional não loga; técnico loga)

---

## Ver Também

- [ADR-009](../adr/009-erros-funcional-vs-tecnico.md) — a decisão por trás deste guia
- [BEST_PRACTICES.md](../../BEST_PRACTICES.md) — seção *Notificações* (visual funcional/técnico)
- [docs/guides/testing-guide.md](./testing-guide.md) — testes
- [docs/guides/zod-guide.md](./zod-guide.md) — validação com Zod
</content>
</invoke>
