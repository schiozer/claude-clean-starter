# 018. Camada de deploy plugável: Vercel, Heroku ou Cloud Run

**Data**: 2026-11-15
**Status**: Aceito — parcialmente substituída pela [ADR-020](./020-esteira-integracao-e-promocao.md) (com o bloco `esteira`, o contrato ganha `deployUat`, `urlUat`, `promoverProd` e `rollbackProd`, e Prod deixa de ser o auto-deploy/rebuild da `main`)

> **Nota (ADR-020).** Com a esteira ligada: o contrato do adaptador ganha `deployUat`, `urlUat`, `promoverProd` e `rollbackProd`, e `deployProd` fica só para o hotfix. Heroku promove o slug do `-uat` (o `-prod` perde o auto-deploy da `main`), Cloud Run promove a imagem pelo digest, Vercel rebuilda o mesmo SHA no FF da `main`.

## Contexto

O template assumia a **Vercel** como único host. A empresa do humano passou a bloquear Vercel,
Netlify, Replit, Railway, Render, Fly.io e StackBlitz, e os 4 projetos derivados (AssistBru.ai,
ContasMes.ai, EvoluiAI, PerformaRM) rodam na Vercel. O humano tem conta pessoal no Heroku e pode
usar Google Cloud (Cloud Run) com conta pessoal.

O fluxo do [ADR-002](./002-estrategia-de-ambientes.md) (PR → UAT, merge → Prod) não pode mudar
para quem usa; só o **host** que o materializa. Neon ([ADR-003](./003-banco-por-ambiente-neon.md)) e
Auth0 ([ADR-004](./004-auth-por-ambiente-auth0.md)) seguem iguais nos três hosts.

## Decisão

1. **Três hosts equivalentes** — Vercel, Heroku e Cloud Run — escolhidos por projeto em
   `deploy.config.json` (raiz). Arquivo ausente ou `host` vazio equivale a `vercel`: os projetos
   existentes continuam funcionando sem mudança. O arquivo só guarda identificadores não secretos
   (validado por `scripts/deploy/config.mjs`); segredos nunca entram nele.
2. **Adaptadores em script** (`scripts/deploy/hosts/<host>.mjs`) com contrato único
   `{ nome, ambienteDePreview, deployPreview, deployProd, encerrarPreview, aguardarPreview? }`,
   escolhidos por `scripts/deploy/index.mjs` (operações `host`, `credenciais`, `preview`, `prod`,
   `encerrar`, `aguardar`) e chamados pelo `deploy.yml`. Somar um host = um adaptador.
   `aguardarPreview` é **opcional** e só o Heroku o implementa; Vercel e Cloud Run não o têm e a
   CLI espera o GitHub Deployment do SHA filtrando pelo predicado `ambienteDePreview` do adaptador
   (Vercel: `Preview*`; Cloud Run: `Preview`, publicado por `deployPreview`). Isto diverge de
   propósito da §5.2 da spec (que previa `aguardarPreview` e `cabecalhosDeAcesso` em todos).
3. **Preview por PR em todos os hosts**: cada PR tem o seu ambiente, e a `Regressão (UAT)`
   ([ADR-016](./016-testes-e2e-nascidos-da-spec.md)) espera a URL: pela API de Deployments do
   GitHub (Vercel e Cloud Run) ou pela Platform API do Heroku.
4. **Heroku**: review app do pipeline; o CI espera o build pela Platform API e registra a URL do PR
   no Auth0 do UAT pela Management API. Prod é o auto-deploy da `main`.
5. **Cloud Run**: credencial por **Workload Identity Federation** (sem chave no GitHub), com Prod
   restrita à `main`. O preview é uma revisão com tag `pr-<n>` e `--no-traffic`; o Auth0 do UAT usa
   um wildcard para as URLs das tags.
6. **Cabeçalhos de acesso do E2E** (bypass da proteção de preview) **não fazem parte do
   adaptador**: vivem em `tests/e2e/support/env.ts` (`cabecalhosDeAcesso`), que só devolve os
   cabeçalhos com `DEPLOY_HOST=vercel` e segredo configurado, e `null` nos demais hosts.
7. **UAT fixo e rollback** ficam nos runbooks do host (`docs/runbooks/host-<host>.md`), com as
   classes de risco do [ADR-013](./013-governanca-operacional-e-runbooks.md); os runbooks gerais
   apontam para o bloco do host. Migrar de host: `migrar-host.md`.
8. O `deploy.yml` **não** é check obrigatório (é no-op em 2 dos 3 hosts); quem bloqueia é a
   `Regressão (UAT)`.

## Consequências

- Custos aproximados: **Vercel** grátis (Hobby); **Heroku** Eco ~US$ 5/mês por conta ou Basic
  ~US$ 7/app; **Cloud Run** ~US$ 0 com cartão cadastrado — exige alerta de orçamento e limpeza
  periódica do Artifact Registry.
- Mais código Node no template, mas testável no Vitest como o resto de `scripts/`.
- Migrar cada projeto é decisão posterior do humano, pelo runbook `migrar-host.md`.
- Adaptar o código de app ao host (ex.: API escrita para `@vercel/node`) não é coberto.

## Alternativas consideradas

- **B — composite actions por host**: menos código, mas lógica em YAML sem teste unitário e o
  bypass do E2E continuaria em código à parte.
- **C — só documentar os hosts, CI preso à Vercel**: Heroku e Cloud Run ficariam sem
  `Regressão (UAT)`, obrigatória pelo ADR-016.
- **Cloudflare, Amplify, Azure**: o contrato permite somar como hosts futuros; fora desta decisão.

Spec: `docs/superpowers/specs/2026-11-13-camada-de-deploy-design.md`.
