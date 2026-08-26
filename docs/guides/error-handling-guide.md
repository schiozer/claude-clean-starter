# Guia de Tratamento de Erros

**Última Atualização**: 2026-07-20  
**Versão**: 1.0.0

---

## Visão Geral

Este guia estabelece padrões para tratamento de erros neste projeto, garantindo:

- **Mensagens user-friendly** para usuários finais
- **Logging completo** para debug e monitoramento
- **Hierarquia de erros** consistente
- **Recuperação** quando possível

---

## Princípios

### 1. Fail Fast

Detecte e reporte erros o mais cedo possível:
```typescript
// ✅ BOM: valida antes de processar
function createProgram(dto: CreateProgramDTO) {
  if (!dto.title) throw new ValidationError('Título obrigatório', 'title')
  // processar
}

// ❌ RUIM: deixa erro acontecer depois
function createProgram(dto: CreateProgramDTO) {
  // ... 50 linhas
  await save({ title: dto.title }) // erro se dto.title === undefined
}
```

### 2. Mensagens para Usuário vs Desenvolvedor

**Usuário**: mensagem amigável, sem detalhes técnicos  
**Desenvolvedor**: log completo com stack trace

```typescript
// Usuário vê:
"Erro ao salvar programa. Tente novamente."

// Log (desenvolvedor):
{
  error: 'AppError: Failed to save program',
  code: 'SAVE_ERROR',
  stack: '...',
  context: { programId: 'abc-123', providerId: 'xyz' },
  timestamp: '2026-07-20T10:30:00Z'
}
```

### 3. Nunca Engolir Erros

```typescript
// ❌ RUIM: erro ignorado
try {
  await dangerousOperation()
} catch (error) {
  // nada
}

// ✅ BOM: logado e tratado
try {
  await dangerousOperation()
} catch (error) {
  logger.error('Operation failed', { error })
  throw new AppError('Erro na operação', 'OPERATION_ERROR')
}
```

---

## Hierarquia de Erros

### Estrutura Base

```typescript
// src/shared/errors/AppError.ts
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public isOperational: boolean = true,
    public context?: Record<string, any>
  ) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context
    }
  }
}
```

**Campos**:
- `message`: mensagem técnica (para logs)
- `code`: código único do erro (ex: `VALIDATION_ERROR`)
- `statusCode`: HTTP status code (400, 404, 500, etc.)
- `isOperational`: `true` se é erro esperado (validação, not found), `false` se é bug
- `context`: dados adicionais para debug

### Erros Específicos

#### ValidationError

```typescript
// src/shared/errors/ValidationError.ts
export class ValidationError extends AppError {
  constructor(
    message: string,
    public field?: string,
    public value?: any
  ) {
    super(message, 'VALIDATION_ERROR', 400, true, { field, value })
  }
}
```

**Uso**:
```typescript
if (!dto.title || dto.title.length < 3) {
  throw new ValidationError(
    'Título deve ter pelo menos 3 caracteres',
    'title',
    dto.title
  )
}
```

#### NotFoundError

```typescript
// src/shared/errors/NotFoundError.ts
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super(
      `${resource} não encontrado`,
      'NOT_FOUND',
      404,
      true,
      { resource, identifier }
    )
  }
}
```

**Uso**:
```typescript
const program = await programRepository.findById(id)
if (!program) {
  throw new NotFoundError('Programa', id)
}
```

#### UnauthorizedError

```typescript
// src/shared/errors/UnauthorizedError.ts
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Não autorizado', action?: string) {
    super(message, 'UNAUTHORIZED', 401, true, { action })
  }
}
```

**Uso**:
```typescript
if (program.provider_id !== userId) {
  throw new UnauthorizedError('Você não pode editar este programa', 'edit_program')
}
```

#### ForbiddenError

```typescript
// src/shared/errors/ForbiddenError.ts
export class ForbiddenError extends AppError {
  constructor(message: string = 'Acesso negado', resource?: string) {
    super(message, 'FORBIDDEN', 403, true, { resource })
  }
}
```

**Uso**:
```typescript
if (!user.isPremium) {
  throw new ForbiddenError('Apenas usuários premium podem criar programas pagos', 'paid_programs')
}
```

#### NetworkError

```typescript
// src/shared/errors/NetworkError.ts
export class NetworkError extends AppError {
  constructor(
    message: string = 'Erro de conexão',
    public url?: string,
    public method?: string
  ) {
    super(message, 'NETWORK_ERROR', 503, true, { url, method })
  }
}
```

**Uso**:
```typescript
try {
  const response = await fetch(url)
} catch (error) {
  throw new NetworkError('Falha ao conectar', url, 'GET')
}
```

#### DatabaseError

```typescript
// src/shared/errors/DatabaseError.ts
export class DatabaseError extends AppError {
  constructor(
    message: string,
    public operation: string,
    public table?: string
  ) {
    super(message, 'DATABASE_ERROR', 500, false, { operation, table })
  }
}
```

**Uso**:
```typescript
const { error } = await db.from('programs').insert(data)
if (error) {
  throw new DatabaseError(
    error.message,
    'insert',
    'programs'
  )
}
```

---

## Mensagens User-Friendly

### Mapeamento

```typescript
// src/shared/errors/errorMessages.ts
export const ERROR_MESSAGES: Record<string, string> = {
  // Validação
  VALIDATION_ERROR: 'Dados inválidos. Verifique os campos e tente novamente.',
  
  // Not Found
  NOT_FOUND: 'O item solicitado não foi encontrado.',
  
  // Autorização
  UNAUTHORIZED: 'Você não tem permissão para realizar esta ação.',
  FORBIDDEN: 'Acesso negado.',
  
  // Rede
  NETWORK_ERROR: 'Erro de conexão. Verifique sua internet e tente novamente.',
  
  // Database
  DATABASE_ERROR: 'Erro ao acessar dados. Tente novamente.',
  SAVE_ERROR: 'Erro ao salvar. Tente novamente.',
  DELETE_ERROR: 'Erro ao excluir. Tente novamente.',
  UPDATE_ERROR: 'Erro ao atualizar. Tente novamente.',
  
  // Arquivos
  FILE_TOO_LARGE: 'Arquivo muito grande. Tamanho máximo: 5MB.',
  FILE_INVALID_TYPE: 'Tipo de arquivo inválido.',
  
  // Genérico
  UNKNOWN_ERROR: 'Erro inesperado. Entre em contato com o suporte.',
}

export function getUserFriendlyMessage(error: AppError | string): string {
  const code = typeof error === 'string' ? error : error.code
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN_ERROR
}
```

### Mensagens Contextualizadas

```typescript
export function getContextualMessage(error: AppError): string {
  const baseMessage = getUserFriendlyMessage(error)
  
  // Adicionar contexto específico
  if (error instanceof NotFoundError) {
    return `${error.context.resource} não encontrado.`
  }
  
  if (error instanceof ValidationError && error.field) {
    return `Campo "${error.field}": ${baseMessage}`
  }
  
  return baseMessage
}
```

---

## Logging

### Logger Simples (MVP)

```typescript
// src/shared/logger/index.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  context?: Record<string, any>
  error?: Error
}

class Logger {
  private shouldLog(level: LogLevel): boolean {
    if (process.env.NODE_ENV === 'production') {
      return level === 'error' || level === 'warn'
    }
    return true // dev: log tudo
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error) {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } as any : undefined
    }

    console[level === 'debug' ? 'log' : level](JSON.stringify(entry, null, 2))
  }

  debug(message: string, context?: Record<string, any>) {
    this.log('debug', message, context)
  }

  info(message: string, context?: Record<string, any>) {
    this.log('info', message, context)
  }

  warn(message: string, context?: Record<string, any>) {
    this.log('warn', message, context)
  }

  error(message: string, context?: Record<string, any>, error?: Error) {
    this.log('error', message, context, error)
  }
}

export const logger = new Logger()
```

**Uso**:
```typescript
logger.info('Program created', { programId: program.id, providerId })
logger.error('Failed to save program', { dto }, error)
```

### Log Estruturado

```typescript
// ✅ BOM: contexto estruturado
logger.error('Database query failed', {
  table: 'programs',
  operation: 'insert',
  userId: user.id,
  data: dto
}, error)

// ❌ RUIM: mensagem não-estruturada
logger.error(`Error inserting into programs for user ${user.id}`)
```

---

## Error Handler Global

### Frontend (React)

```typescript
// src/shared/errors/ErrorHandler.tsx
import { AppError } from './AppError'
import { getUserFriendlyMessage } from './errorMessages'
import { logger } from '@/shared/logger'
import { toast } from 'sonner'

export function handleError(error: unknown, context?: Record<string, any>) {
  logger.error('Error occurred', context, error as Error)

  if (error instanceof AppError) {
    const message = getUserFriendlyMessage(error)
    toast.error(message)
    return
  }

  // Erro desconhecido
  toast.error(ERROR_MESSAGES.UNKNOWN_ERROR)
}

// Error Boundary
import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    logger.error('React Error Boundary caught error', { errorInfo }, error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <h2>Algo deu errado</h2>
          <button onClick={() => window.location.reload()}>
            Recarregar página
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
```

**Uso em App**:
```typescript
// src/app/layout.tsx
import { ErrorBoundary } from '@/shared/errors/ErrorHandler'

export default function RootLayout({ children }) {
  return (
    <ErrorBoundary>
      {children}
    </ErrorBoundary>
  )
}
```

### Backend (API Routes)

```typescript
// src/shared/errors/apiErrorHandler.ts
import { NextRequest, NextResponse } from 'next/server'
import { AppError } from './AppError'
import { getUserFriendlyMessage } from './errorMessages'
import { logger } from '@/shared/logger'

export function handleAPIError(error: unknown, context?: Record<string, any>): NextResponse {
  logger.error('API Error', context, error as Error)

  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: getUserFriendlyMessage(error),
        code: error.code
      },
      { status: error.statusCode }
    )
  }

  // Erro desconhecido
  return NextResponse.json(
    {
      error: ERROR_MESSAGES.UNKNOWN_ERROR,
      code: 'UNKNOWN_ERROR'
    },
    { status: 500 }
  )
}
```

**Uso em Route Handler**:
```typescript
// src/app/api/programs/route.ts
import { handleAPIError } from '@/shared/errors/apiErrorHandler'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const validated = createProgramSchema.parse(body)
    const program = await createProgram(validated)
    
    return NextResponse.json(program, { status: 201 })
  } catch (error) {
    return handleAPIError(error, { endpoint: '/api/programs', method: 'POST' })
  }
}
```

---

## Tratamento por Contexto

### Hooks Customizados

```typescript
// src/presentation/hooks/usePrograms.ts
import { handleError } from '@/shared/errors/ErrorHandler'

export function usePrograms() {
  const [programs, setPrograms] = useState<Program[]>([])
  const [loading, setLoading] = useState(false)

  async function createProgram(dto: CreateProgramDTO) {
    setLoading(true)
    try {
      const validated = createProgramSchema.parse(dto)
      
      const { data, error } = await db
        .from('programs')
        .insert(validated)
        .select()
        .single()
      
      if (error) {
        throw new DatabaseError(error.message, 'insert', 'programs')
      }
      
      setPrograms(prev => [data, ...prev])
      toast.success('Programa criado com sucesso')
      return data
    } catch (error) {
      handleError(error, { operation: 'createProgram', dto })
      throw error
    } finally {
      setLoading(false)
    }
  }

  return { programs, loading, createProgram }
}
```

### Validação Zod

```typescript
import { z } from 'zod'
import { ValidationError } from '@/shared/errors/ValidationError'

function validateWithZod<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0]
      throw new ValidationError(
        firstError.message,
        firstError.path.join('.'),
        data
      )
    }
    throw error
  }
}

// Uso
const validated = validateWithZod(createProgramSchema, formData)
```

### Queries ao banco de dados

```typescript
async function fetchProgram(id: string): Promise<Program> {
  const { data, error } = await db
    .from('programs')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) {
    if (error.code === 'PGRST116') { // not found
      throw new NotFoundError('Programa', id)
    }
    throw new DatabaseError(error.message, 'select', 'programs')
  }
  
  if (!data) {
    throw new NotFoundError('Programa', id)
  }
  
  return data
}
```

---

## Retry Logic

### Retry com Backoff Exponencial

```typescript
// src/shared/utils/retry.ts
interface RetryOptions {
  maxAttempts?: number
  initialDelay?: number
  maxDelay?: number
  backoffMultiplier?: number
  shouldRetry?: (error: Error) => boolean
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    shouldRetry = () => true
  } = options

  let attempt = 1
  let delay = initialDelay

  while (true) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= maxAttempts || !shouldRetry(error as Error)) {
        throw error
      }

      logger.warn(`Retry attempt ${attempt}/${maxAttempts}`, {
        delay,
        error: (error as Error).message
      })

      await new Promise(resolve => setTimeout(resolve, delay))
      
      delay = Math.min(delay * backoffMultiplier, maxDelay)
      attempt++
    }
  }
}
```

**Uso**:
```typescript
const program = await retry(
  () => fetchProgram(id),
  {
    maxAttempts: 3,
    shouldRetry: (error) => error instanceof NetworkError
  }
)
```

---

## Erros Assíncronos

### Promise.all com Tratamento

```typescript
// ❌ RUIM: um erro cancela tudo
const results = await Promise.all([
  fetchPrograms(),
  fetchLessons(),
  fetchExercises()
])

// ✅ BOM: trata erros individuais
const results = await Promise.allSettled([
  fetchPrograms(),
  fetchLessons(),
  fetchExercises()
])

const programs = results[0].status === 'fulfilled' ? results[0].value : []
const lessons = results[1].status === 'fulfilled' ? results[1].value : []
const exercises = results[2].status === 'fulfilled' ? results[2].value : []

// Log erros
results.forEach((result, index) => {
  if (result.status === 'rejected') {
    logger.error(`Operation ${index} failed`, {}, result.reason)
  }
})
```

---

## Testing Error Handling

### Testar Erros Esperados

```typescript
// tests/unit/services/ProgramService.test.ts
import { describe, it, expect, vi } from 'vitest'
import { NotFoundError } from '@/shared/errors/NotFoundError'

describe('ProgramService', () => {
  it('should throw NotFoundError when program not found', async () => {
    const mockRepository = {
      findById: vi.fn().mockResolvedValue(null)
    }
    const service = new ProgramService(mockRepository)

    await expect(
      service.getProgram('non-existent-id')
    ).rejects.toThrow(NotFoundError)

    expect(mockRepository.findById).toHaveBeenCalledWith('non-existent-id')
  })

  it('should handle database errors gracefully', async () => {
    const mockRepository = {
      save: vi.fn().mockRejectedValue(new Error('DB connection failed'))
    }
    const service = new ProgramService(mockRepository)

    await expect(
      service.createProgram({ title: 'Test' })
    ).rejects.toThrow(DatabaseError)
  })
})
```

---

## Monitoramento (Pós-MVP)

### Integração com Sentry

```typescript
// src/shared/monitoring/sentry.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  
  beforeSend(event, hint) {
    const error = hint.originalException
    
    // Não enviar erros operacionais
    if (error instanceof AppError && error.isOperational) {
      return null
    }
    
    return event
  }
})

export function captureError(error: Error, context?: Record<string, any>) {
  Sentry.captureException(error, {
    extra: context
  })
}
```

---

## Checklist

Antes de commitar código com tratamento de erro:

- [ ] Erros personalizados herdam de `AppError`
- [ ] Mensagens user-friendly definidas em `errorMessages.ts`
- [ ] Erros logados com contexto suficiente
- [ ] Try/catch em todas operações assíncronas
- [ ] Validação Zod lança `ValidationError`
- [ ] Queries ao banco tratam `error` e `null`
- [ ] Frontend mostra toast com mensagem amigável
- [ ] Backend retorna status code apropriado
- [ ] Erros testados (unit tests)
- [ ] Sem `console.log` de erro (usar logger)

---

## Recursos

- **Clean Code** - Robert C. Martin (Capítulo sobre Error Handling)
- **You Don't Know JS** - Kyle Simpson (Error Handling)
- **Resilient Web Design** - Jeremy Keith

---

## Ver Também

- [BEST_PRACTICES.md](../../BEST_PRACTICES.md) - Boas práticas gerais
- [docs/guides/zod-guide.md](./zod-guide.md) - Validação com Zod
- [docs/guides/testing-guide.md](./testing-guide.md) - Testes
