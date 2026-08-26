# Guia de Testes

**Última Atualização**: 2026-07-20  
**Versão**: 1.0.0

---

## Visão Geral

Este guia apresenta estratégias e ferramentas de teste para este projeto:

- **Vitest**: testes unitários e de integração
- **Playwright**: testes end-to-end (pós-MVP)
- **Testing Library**: testes de componentes React

---

## Pirâmide de Testes

```
        /\
       /  \
      / E2E\      ← Poucos, lentos, alta confiança
     /______\
    /        \
   /  Integ.  \   ← Médio, velocidade média
  /____________\
 /              \
/   Unit Tests   \ ← Muitos, rápidos, baixa confiança individual
```

**MVP**: foco em testes unitários + validações críticas  
**Pós-MVP**: adicionar integração e E2E

---

## Setup

### Instalação

```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

### Configuração Vitest

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.config.ts',
        '**/*.d.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
```

### Setup File

```typescript
// tests/setup.ts
import '@testing-library/jest-dom'
import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Cleanup após cada teste
afterEach(() => {
  cleanup()
})

// Mock de variáveis de ambiente
process.env.DATABASE_URL = 'http://localhost:54321'
process.env.DATABASE_ANON_KEY = 'test-key'
```

---

## Testes Unitários

### O que Testar

**TESTE**:
- ✅ Lógica de negócio (cálculos, validações)
- ✅ Funções puras (input → output)
- ✅ Edge cases (null, undefined, empty)
- ✅ Validações Zod

**NÃO TESTE** (MVP):
- ❌ Componentes puramente visuais
- ❌ Código trivial (getters/setters)
- ❌ Dependências externas (SDK do banco)

### Estrutura de Diretórios

```
tests/
  ├── setup.ts
  ├── unit/
  │   ├── validators/
  │   │   ├── programSchemas.test.ts
  │   │   └── lessonSchemas.test.ts
  │   ├── utils/
  │   │   ├── calculateProgress.test.ts
  │   │   └── formatDate.test.ts
  │   └── hooks/
  │       └── usePrograms.test.ts
  ├── integration/
  │   └── api/
  │       └── programs.test.ts
  └── e2e/
      └── provider-dashboard.spec.ts
```

### Padrão AAA (Arrange, Act, Assert)

```typescript
// tests/unit/utils/calculateProgress.test.ts
import { describe, it, expect } from 'vitest'
import { calculateProgress } from '@/shared/utils/calculateProgress'

describe('calculateProgress', () => {
  it('should calculate progress percentage correctly', () => {
    // Arrange (preparar)
    const completed = 3
    const total = 10

    // Act (executar)
    const result = calculateProgress(completed, total)

    // Assert (verificar)
    expect(result).toBe(30)
  })

  it('should return 0 when total is 0', () => {
    // Arrange
    const completed = 0
    const total = 0

    // Act
    const result = calculateProgress(completed, total)

    // Assert
    expect(result).toBe(0)
  })

  it('should return 100 when all completed', () => {
    // Arrange
    const completed = 10
    const total = 10

    // Act
    const result = calculateProgress(completed, total)

    // Assert
    expect(result).toBe(100)
  })
})
```

### Testar Validações Zod

```typescript
// tests/unit/validators/programSchemas.test.ts
import { describe, it, expect } from 'vitest'
import { createProgramSchema } from '@/shared/validators/programSchemas'

describe('createProgramSchema', () => {
  it('should validate valid program', () => {
    const valid = {
      title: 'Programa de Força',
      description: 'Programa focado em hipertrofia',
      duration_weeks: 12,
      is_free: false,
      price_brl: 99.90,
      release_mode: 'total'
    }

    expect(() => createProgramSchema.parse(valid)).not.toThrow()
  })

  it('should reject program with short title', () => {
    const invalid = {
      title: 'AB', // menos de 3 caracteres
      is_free: true,
      release_mode: 'total'
    }

    expect(() => createProgramSchema.parse(invalid)).toThrow()
  })

  it('should reject paid program without price', () => {
    const invalid = {
      title: 'Programa Teste',
      is_free: false,
      price_brl: null, // pago mas sem preço
      release_mode: 'total'
    }

    expect(() => createProgramSchema.parse(invalid)).toThrow('Programa pago deve ter preço válido')
  })

  it('should allow free program without price', () => {
    const valid = {
      title: 'Programa Gratuito',
      is_free: true,
      price_brl: null,
      release_mode: 'total'
    }

    expect(() => createProgramSchema.parse(valid)).not.toThrow()
  })
})
```

### Testar Utilitários

```typescript
// tests/unit/utils/formatDate.test.ts
import { describe, it, expect } from 'vitest'
import { formatDate } from '@/shared/utils/formatDate'

describe('formatDate', () => {
  it('should format date to pt-BR', () => {
    const date = new Date('2026-01-15T10:30:00')
    const result = formatDate(date)
    
    expect(result).toBe('15/01/2026')
  })

  it('should handle invalid date', () => {
    const result = formatDate(new Date('invalid'))
    
    expect(result).toBe('Data inválida')
  })

  it('should format with time when option is true', () => {
    const date = new Date('2026-01-15T10:30:00')
    const result = formatDate(date, { includeTime: true })
    
    expect(result).toBe('15/01/2026 às 10:30')
  })
})
```

---

## Testes de Hooks

### Mock do cliente de banco

```typescript
// tests/mocks/db.ts
import { vi } from 'vitest'

export const createMockDbClient = () => ({
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockReturnThis()
  })),
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    signIn: vi.fn(),
    signOut: vi.fn()
  }
})
```

### Testar Hook

```typescript
// tests/unit/hooks/usePrograms.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePrograms } from '@/presentation/hooks/usePrograms'
import { createClient } from '@/lib/db/client'

// Mock do banco
vi.mock('@/lib/db/client', () => ({
  createClient: vi.fn()
}))

describe('usePrograms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch programs on mount', async () => {
    const mockData = [
      { id: '1', title: 'Programa 1' },
      { id: '2', title: 'Programa 2' }
    ]

    const mockDb = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null })
      }))
    }

    vi.mocked(createClient).mockReturnValue(mockDb as any)

    const { result } = renderHook(() => usePrograms())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.programs).toEqual(mockData)
  })

  it('should create program successfully', async () => {
    const newProgram = { id: '3', title: 'Novo Programa' }

    const mockDb = {
      from: vi.fn(() => ({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newProgram, error: null })
      }))
    }

    vi.mocked(createClient).mockReturnValue(mockDb as any)

    const { result } = renderHook(() => usePrograms())

    await waitFor(async () => {
      const created = await result.current.createProgram({
        title: 'Novo Programa',
        is_free: true,
        release_mode: 'total'
      })

      expect(created).toEqual(newProgram)
    })
  })

  it('should handle errors when creating program', async () => {
    const mockError = { message: 'Database error' }

    const mockDb = {
      from: vi.fn(() => ({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: mockError })
      }))
    }

    vi.mocked(createClient).mockReturnValue(mockDb as any)

    const { result } = renderHook(() => usePrograms())

    await waitFor(async () => {
      await expect(
        result.current.createProgram({ title: 'Test', is_free: true, release_mode: 'total' })
      ).rejects.toThrow()
    })
  })
})
```

---

## Testes de Componentes React

### Componente Simples

```typescript
// tests/unit/components/ProgramCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProgramCard } from '@/presentation/components/dashboard/ProgramCard'

describe('ProgramCard', () => {
  const mockProgram = {
    id: '1',
    title: 'Programa de Força',
    description: 'Programa focado em hipertrofia',
    is_free: false,
    price_brl: 99.90,
    published: true
  }

  it('should render program title', () => {
    render(<ProgramCard program={mockProgram} />)
    
    expect(screen.getByText('Programa de Força')).toBeInTheDocument()
  })

  it('should show price when not free', () => {
    render(<ProgramCard program={mockProgram} />)
    
    expect(screen.getByText(/R\$ 99,90/i)).toBeInTheDocument()
  })

  it('should show "Grátis" badge when free', () => {
    const freeProgram = { ...mockProgram, is_free: true }
    render(<ProgramCard program={freeProgram} />)
    
    expect(screen.getByText('Grátis')).toBeInTheDocument()
  })

  it('should call onEdit when edit button clicked', async () => {
    const onEdit = vi.fn()
    const user = userEvent.setup()
    
    render(<ProgramCard program={mockProgram} onEdit={onEdit} />)
    
    const editButton = screen.getByRole('button', { name: /editar/i })
    await user.click(editButton)
    
    expect(onEdit).toHaveBeenCalledWith(mockProgram.id)
  })

  it('should show published badge when published', () => {
    render(<ProgramCard program={mockProgram} />)
    
    expect(screen.getByText('Publicado')).toBeInTheDocument()
  })

  it('should show draft badge when not published', () => {
    const draftProgram = { ...mockProgram, published: false }
    render(<ProgramCard program={draftProgram} />)
    
    expect(screen.getByText('Rascunho')).toBeInTheDocument()
  })
})
```

### Componente com Formulário

```typescript
// tests/unit/components/ProgramFormModal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProgramFormModal } from '@/presentation/components/dashboard/ProgramFormModal'

describe('ProgramFormModal', () => {
  it('should submit form with valid data', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    
    render(<ProgramFormModal isOpen onClose={() => {}} onSubmit={onSubmit} />)
    
    // Preencher campos
    await user.type(screen.getByLabelText(/título/i), 'Programa Teste')
    await user.type(screen.getByLabelText(/descrição/i), 'Descrição do programa')
    await user.click(screen.getByLabelText(/gratuito/i))
    
    // Submeter
    await user.click(screen.getByRole('button', { name: /salvar/i }))
    
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Programa Teste',
        description: 'Descrição do programa',
        is_free: true,
        price_brl: null,
        release_mode: 'total'
      })
    })
  })

  it('should show validation error for short title', async () => {
    const user = userEvent.setup()
    
    render(<ProgramFormModal isOpen onClose={() => {}} onSubmit={() => {}} />)
    
    await user.type(screen.getByLabelText(/título/i), 'AB') // menos de 3 caracteres
    await user.click(screen.getByRole('button', { name: /salvar/i }))
    
    await waitFor(() => {
      expect(screen.getByText(/título deve ter pelo menos 3 caracteres/i)).toBeInTheDocument()
    })
  })

  it('should require price when not free', async () => {
    const user = userEvent.setup()
    
    render(<ProgramFormModal isOpen onClose={() => {}} onSubmit={() => {}} />)
    
    await user.type(screen.getByLabelText(/título/i), 'Programa Pago')
    await user.click(screen.getByLabelText(/pago/i))
    // NÃO preencher preço
    
    await user.click(screen.getByRole('button', { name: /salvar/i }))
    
    await waitFor(() => {
      expect(screen.getByText(/programa pago deve ter preço válido/i)).toBeInTheDocument()
    })
  })
})
```

---

## Testes de Integração (Pós-MVP)

### API Route

```typescript
// tests/integration/api/programs.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@db/db-js'

describe('POST /api/programs', () => {
  let db: any
  let authToken: string

  beforeAll(async () => {
    db = createClient(
      process.env.DATABASE_URL!,
      process.env.DATABASE_SERVICE_KEY!
    )
    
    // Login de teste
    const { data } = await db.auth.signInWithPassword({
      email: 'test@example.com',
      password: 'test123'
    })
    authToken = data.session.access_token
  })

  afterAll(async () => {
    // Cleanup
    await db.auth.signOut()
  })

  it('should create program successfully', async () => {
    const response = await fetch('http://localhost:3000/api/programs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        title: 'Programa Teste',
        description: 'Descrição teste',
        is_free: true,
        release_mode: 'total'
      })
    })

    expect(response.status).toBe(201)
    
    const data = await response.json()
    expect(data).toHaveProperty('id')
    expect(data.title).toBe('Programa Teste')
  })

  it('should return 400 for invalid data', async () => {
    const response = await fetch('http://localhost:3000/api/programs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        title: 'AB' // muito curto
      })
    })

    expect(response.status).toBe(400)
    
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  it('should return 401 without auth', async () => {
    const response = await fetch('http://localhost:3000/api/programs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Programa Teste'
      })
    })

    expect(response.status).toBe(401)
  })
})
```

---

## Testes E2E com Playwright (Pós-MVP)

### Instalação

```bash
npm install --save-dev @playwright/test
npx playwright install
```

### Configuração

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

### Exemplo E2E

```typescript
// tests/e2e/provider-dashboard.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Provider Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login')
    await page.fill('[name=email]', 'provider@example.com')
    await page.fill('[name=password]', 'test123')
    await page.click('button[type=submit]')
    
    // Aguardar redirect
    await page.waitForURL('/dashboard')
  })

  test('should display programs list', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Meus Programas')
    await expect(page.locator('[data-testid=program-card]')).toBeVisible()
  })

  test('should create new program', async ({ page }) => {
    // Abrir modal
    await page.click('button:has-text("Novo Programa")')
    
    // Preencher formulário
    await page.fill('[name=title]', 'Programa E2E Test')
    await page.fill('[name=description]', 'Descrição do teste E2E')
    await page.click('[name=is_free]')
    
    // Salvar
    await page.click('button:has-text("Salvar")')
    
    // Verificar toast de sucesso
    await expect(page.locator('.toast')).toContainText('Programa criado com sucesso')
    
    // Verificar na lista
    await expect(page.locator('text=Programa E2E Test')).toBeVisible()
  })

  test('should edit program', async ({ page }) => {
    // Clicar em editar no primeiro programa
    await page.click('[data-testid=program-card] button:has-text("Editar")').first()
    
    // Editar título
    await page.fill('[name=title]', 'Programa Editado')
    await page.click('button:has-text("Salvar")')
    
    // Verificar atualização
    await expect(page.locator('.toast')).toContainText('Programa atualizado')
    await expect(page.locator('text=Programa Editado')).toBeVisible()
  })

  test('should delete program', async ({ page }) => {
    // Clicar em excluir
    await page.click('[data-testid=program-card] button:has-text("Excluir")').first()
    
    // Confirmar
    await page.click('button:has-text("Confirmar")')
    
    // Verificar toast
    await expect(page.locator('.toast')).toContainText('Programa excluído')
  })
})
```

---

## Coverage (Cobertura)

### Gerar Relatório

```bash
npm run test:coverage
```

### Interpretar

```
File                | % Stmts | % Branch | % Funcs | % Lines
--------------------|---------|----------|---------|--------
All files           |   85.21 |    78.45 |   82.10 |   86.33
 validators/        |   95.00 |    90.00 |   92.00 |   95.50
  programSchemas.ts |   95.00 |    90.00 |   92.00 |   95.50
 utils/             |   88.00 |    85.00 |   80.00 |   89.00
  calculateProgress |   88.00 |    85.00 |   80.00 |   89.00
```

**Metas**:
- MVP: 70% coverage mínimo em lógica crítica
- Pós-MVP: 80% coverage global

---

## Mocking

### Mock de Funções

```typescript
import { vi } from 'vitest'

const mockFn = vi.fn()
mockFn.mockReturnValue(42)
mockFn.mockResolvedValue({ data: [] })
mockFn.mockRejectedValue(new Error('Failed'))

expect(mockFn).toHaveBeenCalled()
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2')
expect(mockFn).toHaveBeenCalledTimes(2)
```

### Mock de Módulos

```typescript
// Mock completo
vi.mock('@/lib/db/client', () => ({
  createClient: vi.fn(() => mockDbClient)
}))

// Mock parcial
vi.mock('@/shared/utils', async () => {
  const actual = await vi.importActual('@/shared/utils')
  return {
    ...actual,
    specificFunction: vi.fn()
  }
})
```

### Mock de Timers

```typescript
import { vi, beforeEach, afterEach } from 'vitest'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('debounce', () => {
  const fn = vi.fn()
  const debounced = debounce(fn, 1000)
  
  debounced()
  debounced()
  debounced()
  
  expect(fn).not.toHaveBeenCalled()
  
  vi.advanceTimersByTime(1000)
  
  expect(fn).toHaveBeenCalledTimes(1)
})
```

---

## Boas Práticas

### 1. Testes Independentes

```typescript
// ❌ RUIM: testes dependentes
let sharedState: any

test('test 1', () => {
  sharedState = { value: 1 }
})

test('test 2', () => {
  expect(sharedState.value).toBe(1) // depende do test 1
})

// ✅ BOM: testes independentes
test('test 1', () => {
  const state = { value: 1 }
  expect(state.value).toBe(1)
})

test('test 2', () => {
  const state = { value: 1 }
  expect(state.value).toBe(1)
})
```

### 2. Testes Descritivos

```typescript
// ❌ RUIM: vago
it('works', () => {})

// ✅ BOM: descreve comportamento
it('should return 0 when total is 0', () => {})
it('should throw ValidationError when title is empty', () => {})
```

### 3. Um Conceito por Teste

```typescript
// ❌ RUIM: testa muita coisa
it('should work', () => {
  expect(createProgram()).toBeDefined()
  expect(updateProgram()).toBeTruthy()
  expect(deleteProgram()).toBeNull()
})

// ✅ BOM: um conceito por teste
it('should create program', () => {
  expect(createProgram()).toBeDefined()
})

it('should update program', () => {
  expect(updateProgram()).toBeTruthy()
})

it('should delete program', () => {
  expect(deleteProgram()).toBeNull()
})
```

### 4. Setup/Teardown

```typescript
import { beforeEach, afterEach } from 'vitest'

describe('ProgramService', () => {
  let service: ProgramService
  let mockRepo: any

  beforeEach(() => {
    mockRepo = createMockRepository()
    service = new ProgramService(mockRepo)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // testes...
})
```

---

## Scripts NPM

```json
// package.json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

---

## CI/CD (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run tests
        run: npm run test:coverage
        
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

---

## Recursos

- **Vitest**: https://vitest.dev/
- **Testing Library**: https://testing-library.com/
- **Playwright**: https://playwright.dev/
- **Kent C. Dodds - Testing JavaScript**: https://testingjavascript.com/

---

## Ver Também

- [BEST_PRACTICES.md](../../BEST_PRACTICES.md) - Boas práticas gerais
- [docs/guides/zod-guide.md](./zod-guide.md) - Validação com Zod
- [docs/guides/error-handling-guide.md](./error-handling-guide.md) - Error handling
