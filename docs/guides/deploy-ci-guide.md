# Guia: Host & CI (recomendação, não decisão vinculante)

> ⚠️ Este é um **guia**, não um ADR. O template **não é uma app** e não trava
> stack (ver `README.md`), então não faz sentido "aceitar" um host aqui. Quando
> você instanciar um **projeto real**, tome a decisão de host/CI e registre-a num
> **ADR próprio do projeto** (a partir de `docs/adr/000-template.md`). Este guia
> só mostra o mapeamento recomendado que materializa as regras já decididas nos
> ADRs 002 e 005.

## O que precisa ser materializado

Os ADRs já fixaram o **comportamento**; falta escolher a **infra** que o executa:

- **3 ambientes** Dev / UAT / Prod ([ADR-002](../adr/template/002-estrategia-de-ambientes.md)).
- **Trunk-based, tudo via PR** ([ADR-005](../adr/template/005-trunk-based-development.md)).
- **PR → deploy em UAT**; **merge na `main` → deploy em Prod** (ADR-002/005).
- **Banco = branches de um projeto Neon único** ([ADR-003](../adr/template/003-banco-por-ambiente-neon.md)).
- **Auth = tenant Auth0 por ambiente** ([ADR-004](../adr/template/004-auth-por-ambiente-auth0.md)).

## Mapeamento recomendado (default)

| Regra | Como materializar (recomendado) |
|---|---|
| PR → UAT | **Vercel Preview Deployment**: cada PR gera um preview com URL própria — é o **UAT** (acessível por site desktop/mobile e no celular). |
| merge → Prod | **Vercel Production**: merge na `main` (branch de produção) dispara o deploy de produção. |
| Checks no PR | **GitHub Actions** (`.github/workflows/ci.yml`, já presente): lint + type-check + test como **required checks** antes do merge. Descomente o job `build` quando houver app. |
| Banco por ambiente | **Integração Vercel ↔ Neon**: cria um **branch Neon por preview** (casa com ADR-003); `main`/Prod aponta para o branch de produção. |
| Auth por ambiente | **Tenant Auth0 por ambiente**; `DATABASE_URL` e chaves do Auth0 vêm dos **Environment Variables do host** por ambiente (Preview vs Production), nunca commitados (ver `.env.local.example`). |
| App nativo (iOS/Android) | Quando existir: **EAS/Expo** ou **Xcode Cloud** + **TestFlight / Internal Testing** para o "UAT" nativo; dev nativo exige **simulador** (ADR-002). |

### Por que Vercel como default

O par `PR → Preview` / `merge → Production` do Vercel encaixa **1:1** no fluxo
`PR → UAT / merge → Prod` sem orquestração extra, e a integração nativa com Neon
entrega branch-per-preview de graça. Não é obrigatório: qualquer host com
preview-por-PR (Netlify, Cloudflare Pages) serve — o que **não** muda é o
comportamento decidido nos ADRs.

## Variáveis de ambiente

Cada ambiente tem seu conjunto de secrets (ver `.env.local.example`):

- **Dev**: `.env.local` (local, nunca versionado).
- **UAT/Preview** e **Prod/Production**: configurados como Environment Variables
  no host, isolados por ambiente. Inclui `DATABASE_URL` (branch Neon do ambiente),
  chaves do tenant Auth0 correspondente e gates como `MAINTENANCE_MODE`.

## Operação por agentes

Deploy e configuração são executados **por runbook**: os procedimentos ficam em
[`docs/runbooks/`](../runbooks/README.md) e as regras (classes de risco R0–R3, aprovação
humana por operação, segredos, registro) no
[ADR-013](../adr/template/013-governanca-operacional-e-runbooks.md). O merge na `main` (= deploy em
Prod) é sempre do humano.

## Quando for criar o ADR do projeto

Registre no ADR do projeto real: host escolhido, gatilhos exatos de deploy, required checks
e o pipeline nativo, se houver. O **como** operar — inclusive o rollback (desligar flag,
promover deploy anterior, revert por PR) — vive nos runbooks
([`rollback.md`](../runbooks/rollback.md)): ao adotar, complete os `<preencher>` e ligue o
`check:runbooks -- --strict` no CI.
