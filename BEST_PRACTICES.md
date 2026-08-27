# Boas Práticas de Desenvolvimento

**Versão do template**: 1.0.0

Padrões de código, convenções e melhores práticas. Seguir estas diretrizes
garante consistência, manutenibilidade, qualidade e colaboração.

---

## Princípios Fundamentais

### 1. Clean Code
- Nomes significativos e auto-explicativos
- Funções pequenas: fazer uma coisa, fazer bem
- Código auto-documentado (evitar comentários óbvios)
- DRY — evitar duplicação
- Boy Scout Rule — deixe o código mais limpo do que encontrou

### 2. KISS — simplicidade > complexidade; resolva o problema atual.

### 3. YAGNI — não implemente "por precaução"; adicione quando o requisito aparecer.

---

## Convenções de Nomenclatura

**camelCase** para variáveis, funções e métodos:
```typescript
const userResources = []
function createResource() {}
const isPublished = true
```

Nomes descritivos e booleanos com prefixo (`is`, `has`, `can`, `should`):
```typescript
const completedItemsCount = 5
const canDelete = true
```

**PascalCase** para classes, interfaces, types e componentes:
```typescript
class ResourceService {}
interface IResourceRepository {}
type ReleaseMode = 'total' | 'time_based'
function ResourceCard() {}
```

**Arquivos**: Componentes em PascalCase (`ResourceCard.tsx`); lógica/hooks em
camelCase (`resourceService.ts`, `useResources.ts`).

**SCREAMING_SNAKE_CASE** para constantes globais:
```typescript
const MAX_FILE_SIZE = 5 * 1024 * 1024
const DEFAULT_TIMEOUT = 30000
```

---

## Estrutura de Código

**Funções — uma responsabilidade:**
```typescript
function calculateProgress(completed: number, total: number): number {
  if (total === 0) return 0
  return Math.round((completed / total) * 100)
}
```

**Parâmetros**: máximo 3; mais que isso, use objeto.

**Early return** para evitar aninhamento:
```typescript
function canPublish(resource: Resource): boolean {
  if (!resource.items.length) return false
  if (!resource.title) return false
  return true
}
```

**Classes** — princípio da responsabilidade única (validador ≠ repositório ≠ e-mail).

**Componentes React** — pequenos, com a lógica extraída para hooks:
```typescript
function ResourceCard({ resource }: Props) {
  const { handleEdit, handleDelete } = useResourceActions(resource.id)
  return <div>{/* ... */}</div>
}
```

---

## TypeScript

- **Tipar sempre.** Evitar `any` — use `unknown` + validação (Zod):
```typescript
function processData(data: unknown): Resource {
  return resourceSchema.parse(data)
}
```
- `interface` para objetos extensíveis; `type` para união/interseção/aliases.

---

## Async/Await

Sempre `try/catch`; evite cadeias de `.then()`:
```typescript
async function fetchResource(id: string): Promise<Resource> {
  try {
    const response = await fetch(`/api/resources/${id}`)
    if (!response.ok) throw new Error('Failed to fetch')
    return await response.json()
  } catch (error) {
    logger.error('fetchResource failed', { id, error })
    throw new AppError('Erro ao carregar recurso', 'FETCH_ERROR')
  }
}
```

---

## Error Handling

Ver [docs/guides/error-handling-guide.md](./docs/guides/error-handling-guide.md).

**Hierarquia de erros:**
```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public isOperational: boolean = true
  ) {
    super(message)
    this.name = this.constructor.name
  }
}
export class ValidationError extends AppError {
  constructor(message: string, public field?: string) { super(message, 'VALIDATION_ERROR', 400) }
}
export class NotFoundError extends AppError {
  constructor(resource: string) { super(`${resource} não encontrado`, 'NOT_FOUND', 404) }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Não autorizado') { super(message, 'UNAUTHORIZED', 401) }
}
```

**Mensagens user-friendly** mapeadas por `code`, e logging com contexto.

---

## Notificações: erro funcional vs. técnico

Nem todo erro é um bug. Distinguir **regra de negócio** de **falha técnica** muda
o tratamento visual e a experiência do usuário.

- **Erro funcional** — regra de negócio esperada (publicar sem itens, excluir algo
  em uso). O usuário fez algo válido; o sistema recusa por um motivo legítimo.
  Mensagem **acionável**, tom acolhedor (aviso), nunca o alarme vermelho de bug.
- **Erro técnico** — algo quebrou (500, rede, timeout). Não é culpa do usuário.
  Tom de alerta, mensagem genérica de "tente novamente".

A distinção usa o **`code`** que a API devolve (`{ error, code }`). Códigos como
`VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `UNAUTHORIZED` são funcionais; o
resto (ou ausência de código) é técnico.

**Melhor que notificar é prevenir:** quando dá para checar a regra no cliente
(ex.: publicar exige ≥1 item), **desabilite a ação** com uma dica contextual em
vez de deixar o erro acontecer. Prefira estados derivados na renderização
(`const canPublish = published || totalItems > 0`) a estados guardados que
precisam ser sincronizados manualmente.

---

## Estilização: tokens semânticos (não cores cruas)

Independentemente da lib de estilo, defina uma **identidade via tokens
semânticos** e use-os em vez de utilitários de cor crus. Trocar um token
repropaga para toda a UI; cores cruas ficam presas ao componente.

```tsx
// ✅ BOM — tokens semânticos
<div className="bg-surface text-foreground border border-border">
<button className="bg-brand text-brand-foreground hover:bg-brand-hover">

// ❌ RUIM — cores cruas, fora de qualquer identidade
<div className="bg-white text-gray-900 border border-gray-200">
<button className="bg-blue-600 text-white hover:bg-blue-700">
```

Defina o conjunto de tokens do seu projeto (background, surface, foreground,
muted, border, brand, destructive, success…), a tipografia e as sombras num
único lugar. Movimento/animações também centralizados e gated por
`prefers-reduced-motion`.

---

## Testes

Ver [docs/guides/testing-guide.md](./docs/guides/testing-guide.md).

Estrutura: `tests/{unit,integration,e2e}`. Nomes descrevem comportamento.
Padrão **AAA** (Arrange, Act, Assert):
```typescript
it('should create resource successfully', async () => {
  const dto = { title: 'Test' }
  const mockRepository = createMockRepository()
  const useCase = new CreateResourceUseCase(mockRepository)

  const result = await useCase.execute(dto, 'owner-id')

  expect(result.title).toBe('Test')
  expect(mockRepository.save).toHaveBeenCalledTimes(1)
})
```

---

## Git

**Commits** — `tipo(escopo): mensagem`. Tipos: `feat`, `fix`, `refactor`, `docs`,
`style`, `test`, `chore`. Imperativo, minúsculo, sem ponto, ≤72 chars.
```
feat(resources): add create resource use case
fix(items): correct order_index on reorder
```

**Branches** — `tipo/descrição-curta` (`feature/resource-editor`).

**Pull Requests** — descreva o quê e o porquê, marque o tipo, checklist, screenshots
se aplicável, e vincule issues (`Closes #123`).

---

## Code Review

**Checklist do revisor**: segue ARCHITECTURE/BEST_PRACTICES; nomes claros; funções
focadas; sem duplicação; erros tratados; testes cobrem casos principais; sem
`console.log`; tipos corretos; sem `any` desnecessário; performance adequada.

**Como revisar**: construtivo e específico ("Linha 42: `n` poderia ser
`completedItemsCount`"), não vago ("nomes ruins").

---

## Performance

- Memoização (`React.memo`, `useCallback`) onde há re-render caro.
- Lazy loading de código sob demanda.
- Queries eficientes: selecione apenas os campos necessários.

---

## Segurança

- **Nunca expor secrets** — use `process.env`, nunca hardcode.
- **Validar input** do usuário (Zod) no front E no back.
- **Sanitizar output** quando renderizar conteúdo não confiável.
- **Autorização no servidor**, fail-closed (ver ARCHITECTURE.md).

---

## Acessibilidade

- HTML semântico (`<button>`, não `<div onClick>`).
- `label` associado a `input` (`htmlFor`/`id`).
- `alt` descritivo em imagens.

---

## Documentação

- JSDoc apenas quando útil (explique o **porquê**, não o óbvio).
- README em módulos com lógica complexa.

---

## Checklist Antes de Commitar

- [ ] Compila sem erros
- [ ] Linter sem warnings (`npm run lint`)
- [ ] Type-check ok (`npm run type-check`)
- [ ] Testes passando (`npm test`)
- [ ] Sem `console.log`/`debugger` e sem código comentado
- [ ] Nomes claros; segue convenções
- [ ] Erros tratados; documentação atualizada (se necessário)

---

## App Nativo (iOS / React Native) — Práticas

> Complementa as práticas acima; as gerais (Clean Code, TS, erros, testes) continuam
> valendo. Ver os padrões arquiteturais em [ARCHITECTURE.md](./ARCHITECTURE.md).

### Segurança no cliente

- **Segredos**: nunca no app (o bundle é público). API keys só no backend.
- **Tokens**: `expo-secure-store` (Keychain), nunca `AsyncStorage` ou estado global.
- **Autorização**: sempre revalidada no servidor; checagens no app são só UX.

### Estilização — tokens semânticos (também no nativo)

Mesma regra da web: defina **tokens semânticos** (cores, tipografia, espaçamento)
num único tema e consuma via tokens, não valores crus. Em RN, centralize num módulo
de tema (ou lib de design system). Anime com moderação e respeite "reduzir
movimento" (`AccessibilityInfo.isReduceMotionEnabled`).

```tsx
// ✅ tokens semânticos
<View style={[t.surface, t.p4]}><Text style={t.foreground}>…</Text></View>
// ❌ valores crus, presos ao componente
<View style={{ backgroundColor: '#fff', padding: 16 }}>
```

### Acessibilidade no nativo

- `accessibilityRole` e `accessibilityLabel` em elementos interativos.
- Alvo de toque mínimo ~44pt; use `hitSlop` quando o alvo for pequeno.
- Suporte a Dynamic Type (não trave fontes em tamanhos absolutos).
- Componentes semânticos (`Pressable`/`Button`) em vez de `View` com `onPress`.

### Listas e performance

- `FlatList`/`SectionList` para listas longas (nunca `.map()` em `ScrollView`).
- `keyExtractor` estável; evite funções/objetos inline no `renderItem`.
- `React.memo`/`useCallback` onde há re-render caro.

### Navegação

- Rotas tipadas (expo-router / react-navigation typed routes).
- Deep links para push (abrir a tela certa a partir da notificação).

### Testes no nativo

- **Unit**: domínio e hooks (Vitest + Testing Library).
- **Integration**: funções do backend (validação + guard + use-case).
- **E2E**: fluxo no simulador iOS (ex.: **Maestro** ou **Detox**) — substitui o
  Playwright da web para telas nativas.

---

## Ferramentas

- **ESLint** (flat config em `eslint.config.mjs`) — `no-explicit-any` como erro.
- **Prettier** (`.prettierrc`) — sem `;`, aspas simples, `printWidth` 100.
- **Vitest** — unit/integration; **Playwright** — E2E.

---

## Ver Também

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [CLAUDE.md](./CLAUDE.md)
- [docs/guides/](./docs/guides/)
- [docs/adr/](./docs/adr/)
