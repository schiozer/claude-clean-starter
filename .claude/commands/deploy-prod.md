---
name: deploy-prod
description: Prepara o merge do PR aprovado no UAT e acompanha o deploy de produção (runbook deploy-prod; o merge é do humano)
---

# Deploy para Produção — via merge do PR (feito pelo humano)

> ⚠️ Só após o UAT ser aprovado pelo usuário.
> 📄 Ambientes (Dev/UAT/Prod): ver [ADR-002](../../docs/adr/template/002-estrategia-de-ambientes.md).
> 🔒 Promove-se o mesmo commit da trunk aprovado em UAT; **o merge é o gatilho de
> produção** (ver [ADR-005](../../docs/adr/template/005-trunk-based-development.md)).
> 🛡️ Operação governada pelo [ADR-013](../../docs/adr/template/013-governanca-operacional-e-runbooks.md).

Use a skill `runbook-execution` com
[`docs/runbooks/deploy-prod.md`](../../docs/runbooks/deploy-prod.md).

- O agente **confere** que o PR está verde e atualizado e que o UAT foi aprovado.
- O **merge na `main` é do humano** (`[R3]`): o agente entrega a instrução e espera a
  confirmação — **nunca** executa `gh pr merge`.
- Depois do merge, o agente acompanha o deploy de produção, faz o smoke test e observa os
  logs.
- Problema em produção → [`docs/runbooks/rollback.md`](../../docs/runbooks/rollback.md).
