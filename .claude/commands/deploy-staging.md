---
name: deploy-staging
description: Abre/atualiza o PR que dispara o deploy em staging/UAT (runbook deploy-uat)
---

# Deploy para Staging (UAT) — via PR

> 📄 Ambientes (Dev/UAT/Prod): ver [ADR-002](../../docs/adr/template/002-estrategia-de-ambientes.md).
> 🔒 **Toda mudança entra na `main` via PR, SEMPRE** — sem push direto na trunk
> (ver [ADR-005](../../docs/adr/template/005-trunk-based-development.md)).
> 🛡️ Operação governada pelo [ADR-013](../../docs/adr/template/013-governanca-operacional-e-runbooks.md).

O deploy em UAT é **disparado pelo PR** (abrir/atualizar um PR → preview em UAT).

Use a skill `runbook-execution` com
[`docs/runbooks/deploy-uat.md`](../../docs/runbooks/deploy-uat.md): pre-flight (conta git,
scope Vercel), checagens locais, push da branch, PR, preview, alias do UAT e smoke test.
Ao final, informe ao usuário a URL do UAT.

O PR usa o template (`.github/pull_request_template.md`) com o **UAT desmarcado**: o agente avisa
que o UAT está pendente e **nunca o marca** (só o humano, após testar).

**NÃO** faz merge — o merge é o gatilho de produção e é do humano (ver `deploy-prod`).
