# Guia de Validação com Zod

**Última Atualização**: 2026-07-20  
**Versão**: 1.0.0

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
- `parse()`: em API routes (throw erro imediatamente)
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

## Casos de Uso neste projeto

### Formulário de Criação de Programa

```typescript
// src/shared/validators/programSchemas.ts
import { z } from 'zod'

export const createProgramSchema = z.object({
  title: z.string()
    .min(3, 'Título deve ter pelo menos 3 caracteres')
    .max(100, 'Título muito longo'),
  
  description: z.string()
    .max(1000, 'Descrição muito longa')
    .nullable(),
  
  duration_weeks: z.number()
    .int('Duração deve ser número inteiro')
    .positive('Duração deve ser positiva')
    .nullable(),
  
  is_free: z.boolean(),
  
  price_brl: z.number()
    .nonnegative('Preço não pode ser negativo')
    .nullable(),
  
  release_mode: z.enum(['total', 'time_based', 'completion_based'], {
    errorMap: () => ({ message: 'Modo de liberação inválido' })
  })
}).refine(
  data => data.is_free || (data.price_brl !== null && data.price_brl > 0),
  {
    message: 'Programa pago deve ter preço válido',
    path: ['price_brl']
  }
)

export type CreateProgramDTO = z.infer<typeof createProgramSchema>
```

### Usar em Componente React

```typescript
// src/presentation/components/dashboard/ProgramFormModal.tsx
import { useState } from 'react'
import { createProgramSchema } from '@/shared/validators/programSchemas'
import { z } from 'zod'

export function ProgramFormModal() {
  const [formData, setFormData] = useState({
    title: '',
    description: null,
    duration_weeks: null,
    is_free: true,
    price_brl: null,
    release_mode: 'total'
  })
  
  const [errors, setErrors] = useState<Record<string, string>>({})
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    
    try {
      const validated = createProgramSchema.parse(formData)
      // Dados válidos, enviar para API
      createProgram(validated)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {}
        error.errors.forEach(err => {
          const field = err.path.join('.')
          fieldErrors[field] = err.message
        })
        setErrors(fieldErrors)
      }
    }
  }
  
  return (
    <form onSubmit={handleSubmit}>
      <input 
        name="title"
        value={formData.title}
        onChange={e => setFormData({ ...formData, title: e.target.value })}
      />
      {errors.title && <span className="error">{errors.title}</span>}
      
      {/* ... outros campos */}
      
      <button type="submit">Salvar</button>
    </form>
  )
}
```

### Usar em API Route

```typescript
// src/presentation/app/api/programs/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createProgramSchema } from '@/shared/validators/programSchemas'
import { z } from 'zod'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    
    // Validar
    const dto = createProgramSchema.parse(body)
    
    // Processar
    const program = await createProgram(dto)
    
    return NextResponse.json(program, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: 'Dados inválidos',
          details: error.errors
        },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Erro interno' },
      { status: 500 }
    )
  }
}
```

---

## React Hook Form + Zod (Pós-MVP)

Para formulários complexos, combinar com React Hook Form:

```bash
npm install react-hook-form @hookform/resolvers
```

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createProgramSchema } from '@/shared/validators/programSchemas'

export function ProgramForm() {
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm({
    resolver: zodResolver(createProgramSchema)
  })
  
  const onSubmit = (data) => {
    // Dados já validados!
    createProgram(data)
  }
  
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('title')} />
      {errors.title && <span>{errors.title.message}</span>}
      
      <input type="number" {...register('price_brl', { valueAsNumber: true })} />
      {errors.price_brl && <span>{errors.price_brl.message}</span>}
      
      <button type="submit">Salvar</button>
    </form>
  )
}
```

---

## Dicas e Boas Práticas

### 1. Schemas em Arquivos Separados

```
src/shared/validators/
  ├── programSchemas.ts
  ├── lessonSchemas.ts
  └── exerciseSchemas.ts
```

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

### 4. Performance

Zod é rápido, mas para arrays grandes use `preprocess`:

```typescript
const schema = z.preprocess(
  val => JSON.parse(val), // pré-processar
  z.array(z.string())     // validar
)
```

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
- ✅ Validar API payloads (backend)
- ✅ Inferir tipos TypeScript automaticamente
- ✅ Mensagens de erro customizáveis
- ✅ Código type-safe e confiável

**Sempre use Zod** quando receber dados externos (user input, API, etc.).
