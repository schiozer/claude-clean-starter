# 019. Stack por catálogo e registro em ADR

**Data**: 2026-11-17
**Status**: Aceito

## Contexto

O template oferece várias escolhas de tecnologia: perfil arquitetural (ADR-011), host (ADR-018),
MCP (ADR-012), vídeos (ADR-017), gate com Claude (ADR-014) e E2E (ADR-016), além de Neon e Auth0
(ADR-001). Cada uma tem o seu ADR, mas nenhum lugar diz **qual** combinação um projeto usa. Para
saber, é preciso garimpar `deploy.config.json`, `CLAUDE.md`, variáveis do GitHub e `package.json`.

Os 4 projetos derivados (AssistBru.ai, ContasMes.ai, EvoluiAI, PerformaRM) estão na Vercel, que
passou a ser bloqueada na empresa do humano. Para migrar, e para começar projetos novos sem
esquecer escolhas, faltava um caminho guiado que só ofereça o que o template sabe montar e
operar.

## Decisão

1. **Catálogo como fonte das opções**: `stack.catalog.json` na raiz (gerenciado pelo
   template-sync), validado à mão por `scripts/stack/catalog.mjs` (sem Zod na raiz, ADR-007).
   Nove dimensões: `perfil`, `formato`, `host`, `banco`, `auth`, `mcp`, `video`, `specGate`,
   `e2e`. Cada opção traz porquê, prós, contras, ADR, runbook de setup, runbook de migração (ou
   `null`) e o código do app que exige, por formato. O teste `stackCatalog.test.ts` garante que
   todo ADR e runbook citado existe e que os hosts do catálogo são os de `scripts/deploy/config.mjs`.
2. **Só o catálogo**: as skills não oferecem nem aceitam tecnologia fora dele. Tecnologia nova
   entra primeiro no template (catálogo + ADR + runbooks), por PR.
3. **ADR de stack por projeto**: `docs/adr/NNN-stack-tecnologica.md`, do projeto (o sync nunca
   toca), com a tabela `Dimensão | Escolha | ADR de detalhe | Desde` e a seção "Fora do catálogo".
   Vigente = o de maior `NNN` com `Status: Aceito`; mudar a stack cria um ADR novo e o anterior
   passa a `Substituído por [NNN]`.
4. **Duas skills**: `architecture-review` acha o ADR vigente e confere com o estado real, ou
   levanta a stack com evidências e gera o ADR por PR; `init-project` usa a review, mostra prós,
   contras e recomendação por dimensão, registra a meta por PR e roda os runbooks de setup
   (projeto novo) ou de migração (projeto existente) pela `runbook-execution`. Dimensão sem
   runbook de migração não migra: a skill avisa e mantém o valor.
5. **Recomendação atual**: `vercel` + `neon` + `auth0`, formato `next-monolito`, MCP ligado,
   vídeos e gate desligados, Playwright. `perfil` sem recomendação (depende do projeto).

## Consequências

- Pergunta "qual é a stack?" se responde lendo um ADR do projeto.
- Mudar a recomendação ou somar uma opção é editar o catálogo; o teste barra opção sem ADR ou
  runbook.
- Só o host tem runbook de migração; banco e auth ficam fixos até ganharem o seu.
- Código do app exigido pela troca (ex.: `Procfile`, servidor Node contínuo) é só listado; cada
  item é um PR do projeto.
- Roadmap: Supabase (banco e auth, muda a autorização para RLS), Firebase (Firestore ou Data
  Connect), runbooks de migração de banco e auth, armazenamento plugável e hosts adicionais.

## Alternativas Consideradas

- **Catálogo em tabela dentro do `SKILL.md`**: zero código, mas catálogo e runbooks saem de
  sincronia sem teste que perceba — fere "só o catálogo".
- **`stack.json` do projeto gerando o ADR**: mais automatizável, mas cria dois registros que
  divergem e o ADR vira artefato gerado.
