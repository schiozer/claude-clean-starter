# 011. Service Layer como porta única, DDD tático por módulos e perfis arquiteturais

**Data**: 2026-10-10
**Status**: Aceito

## Contexto

O template organizava o código **por camada técnica** (`domain/`, `application/use-cases/`,
`infrastructure/`, `presentation/`), com um use-case por classe e o BFF REST como única
borda. Queremos que todo sistema nasça **agêntico**: além da UI/REST, um servidor **MCP**
que LLMs (ChatGPT, Claude, Cursor) chamam em nome do usuário — ver
[ADR-012](./012-mcp-como-borda-agentica.md).

Com mais de uma borda (REST, MCP, Cron), a regra de negócio e a autorização **não podem**
viver nas bordas: cada nova borda seria uma chance de pular um guard. Também precisamos de
um jeito explícito de dizer se um projeto passa por uma fase MVP ou não — projetos
pequenos não devem ser empurrados para "evoluir depois".

## Decisão

1. **Organização por contexto de negócio** (bounded context), não por camada técnica:

   ```
   src/modules/<ctx>/
     domain/          # só no perfil completo: Aggregates, Value Objects, I*Repository
     application/     # <Ctx>Service.ts, schemas.ts (Zod), dto.ts
     infrastructure/  # só no perfil completo: repositórios concretos
     interfaces/      # http/ (REST) e mcp/tools.ts — adaptadores finos
     index.ts         # exporta SÓ service, schemas e DTOs
   src/shared/        # kernel/, auth/, mcp/, errors/
   src/composition.ts # wiring (DI por construtor)
   ```

2. **Application Service como porta única do módulo.** Todo método público recebe
   `actor: AuthUser` como 1º parâmetro e chama um guard (escopo/posse) **antes** de tocar
   dados. Entrada e saída são DTOs validados com Zod; entidades nunca saem do service.
   REST, MCP e Cron chamam **o mesmo** service.

3. **DDD tático pragmático** (perfil completo): Aggregate Root com `create()`/`rehydrate()`
   e métodos com nome de negócio; Value Objects imutáveis que validam na construção;
   repositório por aggregate. Domain events são **opcionais** (só com consumidor real).

4. **Regras de fronteira:**
   1. Fora do módulo importa-se só `modules/<ctx>/index.ts` (ESLint `no-restricted-imports`),
      que exporta service, schemas, DTOs e as factories das bordas (`make<Ctx>Tools(service)`).
      Única exceção: `src/composition.ts` (instancia repositórios e monta services e bordas).
   2. Contexto fala com contexto pelo **service**, nunca pelo repositório.
   3. `interfaces/*` não tem regra de negócio nem autorização.
   4. No MVP não há `domain/` nem `infrastructure/`; promover = extrair para dentro do
      módulo sem alterar `interfaces/`.

5. **Perfis arquiteturais** declarados no `CLAUDE.md` do projeto
   (`**Perfil arquitetural**: mvp-primeiro | completo-direto`):
   - `mvp-primeiro` — começa com service enxuto (skill `mvp-development`) e é promovido
     ao completo por decisão explícita, **por projeto**: ADR do projeto + campo trocado para
     exatamente `mvp-primeiro (promovido — ADR-NNN)`.
   - `completo-direto` — projeto pequeno/estável **sem fase MVP**: nasce e permanece no
     completo (skill `ddd-service-development`).
   - Ausente ou inválido → o agente pergunta antes de agir (fail-closed).

6. A skill `ddd-service-development` **substitui** `post-mvp-development`.

## Consequências

- ➕ Uma borda nova (MCP, webhook, fila) custa um adaptador fino; autorização e regra são
  herdadas do service.
- ➕ Módulos coesos: tudo de um contexto mora junto; fácil de extrair para outro deployable.
- ➕ Promoção MVP → completo não quebra REST nem MCP (assinatura pública do service estável).
- ➖ Services podem crescer demais; mitigação: dividir por subcontexto quando passar de
  ~10 métodos públicos ou misturar linguagens de negócio.
- ➖ Mais um conceito para o time (perfil); mitigação: as skills leem e aplicam o perfil.
- ➖ O walking skeleton fica no layout antigo até a entrega 2 da spec
  `2026-10-10-arquitetura-agentica-mcp-design.md`.

## Alternativas Consideradas

- **Manter organização por camada técnica + use-case por classe**: espalha um contexto por
  4 pastas e não oferece uma porta única óbvia para novas bordas. Descartada.
- **DDD completo como padrão (CQRS, outbox, ACLs)**: poder desnecessário para a maioria dos
  projetos do template (YAGNI). Fica como evolução documentada por projeto.
- **Perfil único (sempre MVP → completo)**: força projetos pequenos a um ciclo que não
  precisam. Descartada a pedido do usuário.
