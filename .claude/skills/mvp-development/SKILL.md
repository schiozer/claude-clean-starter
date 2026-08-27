---
name: mvp-development
description: Skill para desenvolvimento em fase inicial/MVP com arquitetura simples. Use quando a feature é essencial para validação e ainda não justifica as camadas completas de Clean Architecture.
---

# MVP Development

## Visão Geral

Guia o desenvolvimento de features na **fase inicial / MVP**, quando o objetivo é
**validar o produto rápido** com o mínimo de cerimônia arquitetural. A regra é
KISS/YAGNI: só introduza camadas quando a complexidade justificar.

## Quando Usar

- Features essenciais para validar o produto.
- CRUD simples, fluxos diretos.
- Quando pedirem "implemente X no padrão simples/MVP".

**NÃO use** quando a feature cruza vários domínios, tem regra de negócio rica ou
exige testes robustos → use `post-mvp-development`.

## Decisões Arquiteturais (MVP)

- ✅ **Acesso a dados via hooks** (`use*`) que chamam uma **API Route/BFF** — não
  há SDK de banco no cliente (com Postgres puro, ex.: Neon, todo acesso passa pelo
  servidor: `hook → /api → DB`). Validação na borda (cliente e servidor).
- ✅ **Validação com Zod** no ponto de entrada (formulários, rotas).
- ✅ **Autorização no servidor**, fail-closed — nunca confie apenas no cliente.
- ✅ **Hooks customizados** (`useState` + `useEffect`) para estado local.
- ✅ **Context API** só quando necessário (ex.: sessão/auth).
- ❌ SEM use-cases, repositories ou services.
- ❌ SEM camada de server-state (ex.: React Query) até doer.

## Exemplo (hook simples)

```typescript
// src/presentation/hooks/useResources.ts
export function useResources() {
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { void fetchResources() }, [])

  async function fetchResources() {
    try {
      const res = await fetch('/api/resources')
      if (!res.ok) throw new Error('fetch failed')
      setResources(await res.json())
    } catch {
      notify.error('Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }

  return { resources, loading, fetchResources }
}
```

## Checklist (MVP)

- [ ] Validação Zod na borda
- [ ] Autorização no servidor
- [ ] Erros tratados (funcional vs técnico — ver BEST_PRACTICES)
- [ ] Loading/erro na UI
- [ ] TypeScript sem `any`
- [ ] Teste ao menos das validações e dos hooks críticos

## Quando Graduar para Pós-MVP

Migre para `post-mvp-development` quando surgir: regra de negócio que cruza
entidades, necessidade de trocar infraestrutura sem tocar o domínio, ou cobertura
de testes robusta. Documente a virada em um ADR.
