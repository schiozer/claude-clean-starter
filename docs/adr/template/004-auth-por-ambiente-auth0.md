# 004. Autenticação por Ambiente (Auth0)

**Data**: 2026-08-27
**Status**: Aceito

## Contexto

[ADR-001](./001-neon-auth0.md) fixou **Auth0** como IdP, e
[ADR-002](./002-estrategia-de-ambientes.md) exige autenticação isolada nos três
ambientes (Dev / UAT / Prod). Falta decidir **como** o Auth0 separa os ambientes.

Forças:

1. **Isolamento** — usuários, chaves de assinatura, connections e callbacks de
   teste não podem se misturar com produção.
2. **Segurança** — vazar um usuário de teste com privilégios em Prod é
   inaceitável; a assinatura de JWT deve ser distinta por ambiente.
3. **Configuração realista** — UAT precisa validar o fluxo de login como Prod.

## Decisão

**Um tenant Auth0 separado por ambiente: `dev`, `uat` e `prod`.**

- Cada tenant tem suas próprias **Applications**, **Connections**, usuários,
  chaves de assinatura e **callback/logout URLs** (localhost no dev; URLs de UAT;
  URLs de Prod).
- O app recebe domínio/clientId/audience do tenant via os **secrets por ambiente**
  de [ADR-002](./002-estrategia-de-ambientes.md) — nunca commitados.
- A **autorização** permanece **fail-closed nos guards da camada de aplicação**
  (ADR-001): o JWT/OIDC do tenant correspondente é validado no BFF antes de tocar
  o repositório. Trocar de ambiente = trocar a configuração do tenant, não o
  código de authz.
- Web, iOS e Android de um mesmo ambiente consomem **o mesmo tenant** daquele
  ambiente.

## Consequências

**Fica mais fácil**
- Isolamento total de identidade por ambiente; zero risco de usuário de teste em Prod.
- Configuração de callbacks limpa por ambiente (localhost vs. UAT vs. Prod).
- Rotação/incidente de chave afeta só o ambiente atingido.

**Fica mais difícil / dívidas assumidas**
- Manter três tenants em sincronia (regras, actions, connections) — mitigável com
  Infra-as-Code do Auth0 (ex.: Deploy CLI / Terraform).
- Consumo de tenants do plano Auth0 — reavaliar tier conforme o produto cresce
  (ADR-001 já sinaliza o custo por MAU).

## Alternativas Consideradas

- **Um tenant único com Applications/Connections separadas por ambiente** — menos
  tenants, porém usuários e configs compartilham o mesmo espaço, com risco real de
  dado de teste aparecer em Prod. Descartado por ferir o isolamento exigido pelo
  ADR-002.
- **IdP diferente em Dev (ex.: mock local)** — descartado por reduzir paridade do
  fluxo de login; Dev deve exercitar o mesmo Auth0 que UAT/Prod.
