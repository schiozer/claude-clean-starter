# 001. Banco (Neon) e Autenticação (Auth0)

**Data**: 2026-08-26
**Status**: Aceito

## Contexto

O template é agnóstico de infraestrutura, mas o projeto real precisa fixar banco
e provedor de identidade. Três forças pesam na decisão:

1. **Arquitetura** — seguimos Clean Architecture (DIP): banco atrás de
   `I*Repository`, identidade atrás de `IAuthProvider`, regra de negócio em
   use-cases/guards. A infra deve ser trocável sem tocar o domínio.
2. **Multi-cliente** — o produto deve poder virar **app iOS/Android nativo** além
   da web. Queremos construir a regra de negócio **uma vez** e consumi-la de
   todos os clientes.
3. **Desenvolvimento assistido por IA (MCP)** — os agentes operam banco e infra
   via MCP; precisamos de isolamento para experimentos destrutivos sem risco a
   dados de dev/prod.

A alternativa natural seria um BaaS acoplado (Supabase), que entrega
banco+auth+storage+realtime num produto só.

## Decisão

Adotar **Neon** (Postgres serverless) como banco e **Auth0** como IdP.

- **Autorização** = **guards na camada de aplicação** (`src/application/authz/`),
  fail-closed, validando o JWT/OIDC do Auth0. RLS no Neon fica como reforço
  opcional, nunca como única camada.
- **Acesso a dados** sempre via **API/BFF** (`hook → /api → Neon`) — não há SDK
  de banco no cliente. Web, iOS e Android consomem o mesmo endpoint com o mesmo
  JWT do Auth0.
- Neon atrás de `I*Repository`; Auth0 atrás de `IAuthProvider`.

## Consequências

**Fica mais fácil**
- Portabilidade: Postgres puro (Neon), sem camada proprietária no banco.
- Multi-cliente: regra de negócio única na API; iOS (`Auth0.swift`) e Android
  (`Auth0.Android`) reusam identidade e endpoints sem reimplementar acesso a dados.
- Workflow com IA/MCP: o **branching do Neon** permite ao agente criar um branch
  isolado, rodar migrations destrutivas, verificar e descartar — sem risco a
  dados reais. MCP servers maduros para Neon (branch + SQL + migrations) e Auth0.
- Identidade enterprise: SSO/SAML, MFA, organizations, FGA quando necessário.

**Fica mais difícil / dívidas assumidas**
- Mais montagem inicial: Storage, realtime e functions são serviços à parte (não
  vêm no pacote).
- **Custo do Auth0 escala com MAU** — reavaliar tiers/FGA se o produto virar B2C
  de alto volume; considerar migração de IdP (isolado por `IAuthProvider`) se o
  custo dominar.
- Obrigatório ter camada de API desde cedo (alinhado à Clean Arch, porém mais
  trabalho no MVP do que um SDK client-direct).

## Alternativas Consideradas

- **Supabase (BaaS acoplado)** — melhor time-to-MVP e SDK nativo client-direct
  (iOS/Android falam direto com o DB + RLS). Descartado porque empurra a regra de
  negócio para RLS/funções Postgres (difícil de testar/versionar, briga com a
  Clean Architecture) e espalha o acesso a dados por cada cliente; lock-in em
  auth/storage/realtime. Venceria se o objetivo fosse só um MVP web single-client.
- **Postgres gerenciado "tradicional" (RDS/Cloud SQL) + Auth0** — sem scale-to-zero
  nem branching; pior ergonomia para o workflow de IA/MCP.
