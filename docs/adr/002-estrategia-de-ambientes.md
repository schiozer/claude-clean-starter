# 002. Estratégia de Ambientes (Dev / UAT / Prod)

**Data**: 2026-08-27
**Status**: Aceito

## Contexto

O projeto precisa de uma regra fixa e explícita sobre **quais ambientes existem**
e **como cada um roda**. Sem isso, dev, banco, auth e deploy viram decisões
ad-hoc por pessoa, o que quebra paridade, mistura dados de teste com produção e
torna o fluxo de release imprevisível.

Forças:

1. **Paridade** — quanto mais parecidos os ambientes, menos "funciona na minha
   máquina". A stack (plataforma, banco, auth) deve ser a mesma em todos.
2. **Isolamento** — dados e credenciais de teste **nunca** podem tocar produção.
3. **Multi-cliente** — o produto pode virar **app iOS/Android nativo** além da web
   (ver [ADR-001](./001-neon-auth0.md)); a política de ambientes precisa valer
   para clientes web **e** nativos.
4. **Release previsível** — já existem os commands `deploy-staging`, `uat` e
   `deploy-prod`; eles precisam de uma decisão registrada que os sustente.

## Decisão

**Todo o projeto existe sempre em três ambientes — Dev, UAT e Prod — para
plataforma, banco e autenticação. Não há exceção.**

| Ambiente | Plataforma / App | Como roda |
|---|---|---|
| **Dev** | roda **local** | Web: `localhost`. **App nativo iOS/Android: simulador obrigatório** (iOS Simulator / Android Emulator) para os testes de dev — nenhum teste de dev nativo é considerado válido sem rodar em simulador. |
| **UAT** | deployado | Acessível por **site (browser desktop e mobile)** e **no celular**. App nativo: distribuição interna (TestFlight / Internal Testing track). |
| **Prod** | produção | Prod é prod. |

Regras que decorrem da decisão:

- **Stack idêntica** nos três ambientes: mesma plataforma, mesmo tipo de banco
  ([Neon — ADR-003](./003-banco-por-ambiente-neon.md)) e mesmo IdP
  ([Auth0 — ADR-004](./004-auth-por-ambiente-auth0.md)).
- **Secrets próprios por ambiente**: cada ambiente tem seu conjunto de variáveis
  (`.env.dev`, `.env.uat`, `.env.prod` — ou o mecanismo de secrets do host),
  **nunca** commitados. Credenciais nunca são compartilhadas entre ambientes.
- **Fluxo de promoção dirigido por PR** (ver
  [ADR-005](./005-trunk-based-development.md)):
  - **Abrir/atualizar um PR → deploy automático em UAT.** UAT é o ambiente do PR,
    acessível por site/celular para o teste de aceitação.
  - **Aprovar o UAT e fazer merge na `main` → deploy automático em Prod.** Só se
    faz merge (e portanto só se promove para Prod) o que foi aprovado em UAT.
- Os commands `deploy-staging`, `uat` e `deploy-prod` documentam/apoiam esse fluxo;
  o disparo em si é do CI (PR → UAT, merge → Prod), não um push manual.
- **Promoção por artefato/commit**, não por branch de ambiente — ver
  [ADR-005 (Trunk-Based Development)](./005-trunk-based-development.md).

**Fora de escopo deste ADR**: a escolha do **host** concreto (Vercel, Fly, etc.)
é uma decisão separada, a ser registrada em ADR futuro. Este ADR é agnóstico de
host — fixa apenas a política dos três ambientes.

## Consequências

**Fica mais fácil**
- Paridade e previsibilidade: o que passou em UAT tende a se comportar igual em Prod.
- Isolamento de dados/credenciais por ambiente, reduzindo risco de vazamento em Prod.
- Onboarding: a regra é única e explícita para web e nativo.

**Fica mais difícil / dívidas assumidas**
- Custo operacional de manter três ambientes (banco, tenants de auth, deploy).
- App nativo exige toolchain de simulador configurada em todo dev — passo a mais
  no setup, mas obrigatório.
- Gestão de três conjuntos de secrets.

## Alternativas Consideradas

- **Só Dev + Prod (sem UAT)** — mais barato, porém sem ambiente de aceitação
  realista; empurra a validação para produção. Descartado: o produto precisa de
  UAT acessível por site/celular antes de liberar.
- **Ambientes compartilhados/ad-hoc** — sem política fixa. Descartado por quebrar
  paridade e isolamento.
- **Dev nativo só em device físico** — descartado como regra: device físico é
  bem-vindo, mas o **simulador é o piso obrigatório** para reprodutibilidade dos
  testes de dev.
