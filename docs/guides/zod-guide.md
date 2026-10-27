# Guia de Validação com Zod

**Última Atualização**: 2026-10-10
**Versão**: 2.0.0

---

## O que é Zod?

**Zod** é uma biblioteca TypeScript-first para declaração e validação de schemas. Ela permite:

- ✅ Validar dados em runtime (formulários, API payloads)
- ✅ Inferir tipos TypeScript automaticamente
- ✅ Mensagens de erro customizáveis
- ✅ Zero dependências
- ✅ Funciona no browser e Node.js

**Site**: https://zod.dev/

---

## Instalação

```bash
npm install zod
```

Já instalado neste projeto via `package.json`.

---

## Conceitos Básicos

### Schema Simples

```typescript
import { z } from 'zod'

// Definir schema
const userSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email()
})

// Inferir tipo
type User = z.infer<typeof userSchema>
// type User = { name: string; age: number; email: string }

// Validar dados
const data = {
  name: 'João',
  age: 30,
  email: 'joao@example.com'
}

const result = userSchema.safeParse(data)
if (result.success) {
  console.log(result.data) // { name: 'João', age: 30, email: 'joao@example.com' }
} else {
  console.log(result.error) // ZodError com detalhes
}
```

### Parse vs SafeParse

**`parse()`**: lança exceção se inválido
```typescript
try {
  const validated = schema.parse(data)
  // usa validated
} catch (error) {
  if (error instanceof z.ZodError) {
    console.log(error.errors)
  }
}
```

**`safeParse()`**: retorna objeto com `success` flag
```typescript
const result = schema.safeParse(data)
if (!result.success) {
  console.log(result.error.errors)
} else {
  console.log(result.data)
}
```

**Quando usar**:
- `parse()`: nas bordas do servidor (handler REST, tool MCP) — o `ZodError` sobe e a
  fronteira de erro o traduz (ver [error-handling-guide](./error-handling-guide.md))
- `safeParse()`: em formulários (mostrar erros inline)

---

## Tipos Primitivos

```typescript
// String
z.string()
z.string().min(3)                  // mínimo 3 caracteres
z.string().max(100)                // máximo 100 caracteres
z.string().email()                 // valida email
z.string().url()                   // valida URL
z.string().uuid()                  // valida UUID
z.string().regex(/^\d{3}-\d{3}$/)  // regex customizado

// Number
z.number()
z.number().int()                   // inteiro
z.number().positive()              // > 0
z.number().nonnegative()           // >= 0
z.number().min(0).max(100)         // entre 0 e 100

// Boolean
z.boolean()

// Date
z.date()
z.date().min(new Date('2020-01-01'))
z.date().max(new Date())           // não pode ser futuro

// Literal
z.literal('total')                 // aceita apenas 'total'

// Enum
z.enum(['total', 'time_based', 'completion_based'])

// Nullable / Optional
z.string().nullable()              // string | null
z.string().optional()              // string | undefined
z.string().nullish()               // string | null | undefined
```

---

## Objetos

```typescript
const programSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().max(1000).nullable(),
  duration_weeks: z.number().int().positive().nullable(),
  is_free: z.boolean(),
  price_brl: z.number().nonnegative().nullable(),
  release_mode: z.enum(['total', 'time_based', 'completion_based'])
})

type Program = z.infer<typeof programSchema>
```

### Campos Opcionais

```typescript
const schema = z.object({
  name: z.string(),
  email: z.string().email().optional(), // pode estar ausente
  age: z.number().optional()
})

// Válido
{ name: 'João' }
{ name: 'João', email: 'joao@example.com' }
{ name: 'João', age: 30 }
```

### Valores Padrão

```typescript
const schema = z.object({
  name: z.string(),
  role: z.string().default('student') // se ausente, usa 'student'
})

const result = schema.parse({ name: 'João' })
console.log(result) // { name: 'João', role: 'student' }
```

---

## Validações Customizadas

### refine()

```typescript
const programSchema = z.object({
  is_free: z.boolean(),
  price_brl: z.number().nonnegative().nullable()
}).refine(
  data => data.is_free || (data.price_brl !== null && data.price_brl > 0),
  {
    message: 'Programa pago deve ter preço válido',
    path: ['price_brl'] // campo onde erro aparece
  }
)

// Válido
{ is_free: true, price_brl: null }
{ is_free: false, price_brl: 29.90 }

// Inválido
{ is_free: false, price_brl: null }  // erro em price_brl
```

### superRefine()

```typescript
const schema = z.object({
  password: z.string().min(6),
  confirm_password: z.string()
}).superRefine((data, ctx) => {
  if (data.password !== data.confirm_password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Senhas não coincidem',
      path: ['confirm_password']
    })
  }
})
```

---

## Arrays

```typescript
// Array de strings
z.array(z.string())

// Array de objetos
z.array(z.object({
  id: z.string(),
  name: z.string()
}))

// Array com min/max
z.array(z.string()).min(1).max(10) // 1 a 10 itens

// Array não-vazio
z.array(z.string()).nonempty()
```

---

## Uniões e Interseções

### Union (OU)

```typescript
const valueSchema = z.union([
  z.string(),
  z.number()
])

// Válido
valueSchema.parse('hello')
valueSchema.parse(42)

// Discriminated Union (recomendado)
const contentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('video'), url: z.string().url() })
])

// Válido
{ type: 'text', text: 'Hello' }
{ type: 'video', url: 'https://youtube.com/...' }
```

### Intersection (E)

```typescript
const baseSchema = z.object({
  id: z.string(),
  created_at: z.date()
})

const userSchema = baseSchema.and(
  z.object({
    name: z.string(),
    email: z.string().email()
  })
)

// Equivalente a:
// { id: string, created_at: Date, name: string, email: string }
```

---

## Transformações

```typescript
const schema = z.string().transform(val => val.toUpperCase())

const result = schema.parse('hello')
console.log(result) // 'HELLO'

// Com validação + transformação
const emailSchema = z.string()
  .email()
  .transform(val => val.toLowerCase())

emailSchema.parse('USER@EXAMPLE.COM') // 'user@example.com'
```

---

## Erros

### Estrutura de Erro

```typescript
const schema = z.object({
  name: z.string().min(3),
  age: z.number().positive()
})

const result = schema.safeParse({
  name: 'Jo',
  age: -1
})

if (!result.success) {
  console.log(result.error.errors)
  // [
  //   {
  //     code: 'too_small',
  //     minimum: 3,
  //     type: 'string',
  //     inclusive: true,
  //     message: 'String must contain at least 3 character(s)',
  //     path: ['name']
  //   },
  //   {
  //     code: 'too_small',
  //     minimum: 0,
  //     type: 'number',
  //     inclusive: false,
  //     message: 'Number must be greater than 0',
  //     path: ['age']
  //   }
  // ]
}
```

### Mensagens Customizadas

```typescript
const schema = z.object({
  name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  age: z.number().positive('Idade deve ser positiva')
})

// Ou inline
z.string().min(3, { message: 'Nome muito curto' })
```

### Traduzir Mensagens

```typescript
import { z } from 'zod'
import { zodI18nMap } from 'zod-i18n-map'
import i18next from 'i18next'

// Configurar i18next com traduções pt-BR
i18next.init({
  lng: 'pt-BR',
  resources: {
    'pt-BR': {
      zod: require('zod-i18n-map/locales/pt-BR/zod.json')
    }
  }
})

z.setErrorMap(zodI18nMap)

// Agora erros vêm em português
```

---

## Zod neste projeto: um schema, três bordas

Os schemas de um contexto moram em **`src/modules/<ctx>/application/schemas.ts`** e são
exportados pelo `index.ts` do módulo. O **mesmo** schema valida a entrada na UI, no
handler REST e na tool MCP — e o `<Ctx>Service` recebe o tipo inferido
([ADR-011](../adr/template/011-service-layer-ddd-modular-e-perfis.md)).

```
UI (safeParse, erros inline) ─┐
REST handler (parse) ─────────┼──► createResourceSchema ──► ResourceService.create(actor, input)
Tool MCP (parse + JSON Schema)┘
```

### Schemas do módulo

```typescript
// src/modules/resources/application/schemas.ts
import { z } from 'zod'

export const createResourceSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Título deve ter de 3 a 100 caracteres')
    .max(100, 'Título deve ter de 3 a 100 caracteres')
    .describe('Título do recurso'),
})

export const listResourcesSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20).describe('Quantidade máxima (≤ 50)'),
  cursor: z.string().optional().describe('Cursor devolvido pela página anterior'),
})

export type CreateResourceInput = z.infer<typeof createResourceSchema>
export type ListResourcesInput = z.infer<typeof listResourcesSchema>
```

Três regras que valem para todo schema de entrada:

- **Nunca** inclua `ownerId`, `tenantId` ou `userId` no schema de entrada: quem age vem do
  `actor`, não do input (a LLM ou o cliente não escolhem de quem é o dado).
- Paginação com `limit` ≤ 50 e `cursor` — saída pequena é UX para a LLM também.
- `.describe()` nos campos: vira a descrição do parâmetro no JSON Schema que a tool MCP
  publica, e ajuda a LLM a preencher certo.

> **Zod valida forma; o domínio valida regra.** O schema barra o óbvio cedo (tipo,
> tamanho). A invariante de negócio continua no Value Object (`Title.of`) ou no aggregate
> — é ela que vale quando o service é chamado por qualquer borda (Cron incluso).

### Saída também é contrato (DTO)

```typescript
// src/modules/resources/application/dto.ts
export const resourceDTOSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerId: z.string(),
  createdAt: z.string().datetime(),
})
export type ResourceDTO = z.infer<typeof resourceDTOSchema>
```

O service **nunca** devolve entidade, só DTO. O schema de saída serve de `outputSchema`
na tool MCP e de tipo na UI.

### Na UI (formulário)

```typescript
// src/ui/components/ResourceForm.tsx
import { useState } from 'react'
import { createResourceSchema } from '@/modules/resources'
import { useResources } from '@/ui/hooks/useResources'

export function ResourceForm() {
  const { create } = useResources()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = createResourceSchema.safeParse({ title })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    setError(null)
    if (await create(parsed.data.title)) setTitle('')
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="title">Título</label>
      <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      {error && <span role="alert">{error}</span>}
      <button type="submit">Salvar</button>
    </form>
  )
}
```

> A UI só pode importar **schemas e DTOs** do módulo (código puro, sem servidor). Service,
> repositórios e bordas ficam no servidor.

### No handler REST

```typescript
// src/modules/resources/interfaces/http/handlers.ts (trecho)
async POST(req: Request): Promise<Response> {
  try {
    const actor = await resolveActor(req)
    const input = createResourceSchema.parse(await req.json())
    return Response.json(await service.create(actor, input), { status: 201 })
  } catch (error) {
    return handleApiError(error, 'api/resources:POST') // ZodError → 400 VALIDATION_ERROR
  }
}
```

Nada de `try/catch` específico para `ZodError` no handler: `handleApiError` já devolve
`{ error, code: 'VALIDATION_ERROR' }` com a primeira mensagem do schema.

### Na tool MCP

```typescript
// src/modules/resources/interfaces/mcp/tools.ts (trecho)
defineTool({
  name: 'create_resource',
  description: 'Cria um recurso com o título informado.',
  input: createResourceSchema,
  scope: 'resources:write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  flag: 'mcp.resources.write',
  handler: (actor, input) => service.create(actor, input),
})
```

O `defineTool` usa o schema duas vezes: converte-o em **JSON Schema** para o `tools/list`
(é o que a LLM vê) e faz o `parse` dos `arguments` antes do handler. Input inválido vira
`isError: true` com a mensagem do schema — acionável para a LLM.

---

## React Hook Form + Zod (quando o formulário crescer)

Para formulários com muitos campos, combine com React Hook Form — o schema continua o
mesmo do módulo:

```bash
npm install react-hook-form @hookform/resolvers
```

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createResourceSchema, type CreateResourceInput } from '@/modules/resources'

export function ResourceForm({ onSubmit }: { onSubmit: (data: CreateResourceInput) => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateResourceInput>({ resolver: zodResolver(createResourceSchema) })

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label htmlFor="title">Título</label>
      <input id="title" {...register('title')} />
      {errors.title && <span role="alert">{errors.title.message}</span>}
      <button type="submit">Salvar</button>
    </form>
  )
}
```

---

## Dicas e Boas Práticas

### 1. Schemas por módulo

```
src/modules/
  ├── resources/application/schemas.ts
  ├── billing/application/schemas.ts
  └── ...
```

Um módulo não importa o `schemas.ts` interno de outro: importa pelo `index.ts`
(`@/modules/billing`).

### 2. Reutilizar Schemas

```typescript
const baseExerciseSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(1000).nullable()
})

export const createExerciseSchema = baseExerciseSchema.extend({
  provider_id: z.string().uuid()
})

export const updateExerciseSchema = baseExerciseSchema.partial()
// Todos campos opcionais
```

### 3. Validar Arrays

```typescript
const createLessonSchema = z.object({
  title: z.string().min(3),
  exercises: z.array(
    z.object({
      exercise_id: z.string().uuid(),
      sets: z.number().int().positive().nullable(),
      reps: z.number().int().positive().nullable()
    })
  ).min(1, 'Aula deve ter pelo menos 1 exercício')
})
```

### 4. Erros de validação não são bugs

`ZodError` é erro **funcional**: vira 400 no REST e `isError: true` no MCP, e **não** vai
para o log (ver [ADR-009](../adr/template/009-erros-funcional-vs-tecnico.md)). Escreva as mensagens
em pt-BR e acionáveis — elas chegam ao usuário e à LLM.

---

## Debugging

### Ver Estrutura do Erro

```typescript
try {
  schema.parse(data)
} catch (error) {
  if (error instanceof z.ZodError) {
    console.log(JSON.stringify(error.format(), null, 2))
    // Estrutura hierárquica dos erros
  }
}
```

### Validar Parcialmente

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number()
})

// Validar apenas 'name'
const partialSchema = schema.pick({ name: true })
```

---

## Recursos

- **Docs Oficiais**: https://zod.dev/
- **GitHub**: https://github.com/colinhacks/zod
- **Examples**: https://github.com/colinhacks/zod#examples

---

## Resumo

**Zod é essencial neste projeto para**:
- ✅ Validar formulários (frontend)
- ✅ Validar payloads REST e `arguments` de tools MCP (backend) — com o mesmo schema
- ✅ Publicar o JSON Schema das tools MCP para a LLM
- ✅ Inferir tipos TypeScript automaticamente
- ✅ Mensagens de erro customizáveis
- ✅ Código type-safe e confiável

**Sempre use Zod** quando receber dados externos (user input, API, etc.).
