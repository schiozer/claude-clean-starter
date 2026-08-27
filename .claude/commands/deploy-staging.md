---
name: deploy-staging
description: Abre/atualiza o PR que dispara o deploy em staging/UAT
---

# Deploy para Staging (UAT) — via PR

> ⚠️ Ajuste a estratégia de branch/host ao SEU ambiente.
> 📄 Ambientes (Dev/UAT/Prod): ver [ADR-002](../../docs/adr/002-estrategia-de-ambientes.md).
> 🔒 **Toda mudança entra na `main` via PR, SEMPRE** — sem push direto na trunk
> (ver [ADR-005](../../docs/adr/005-trunk-based-development.md)).

O deploy em UAT é **disparado pelo PR** (abrir/atualizar um PR → deploy automático
em UAT). Este command prepara e abre esse PR.

1. Garantir a **conta git correta** para este repositório (ver regra 5 do CLAUDE.md).
2. `git status` — verificar mudanças pendentes.
3. Criar uma **feature branch curta** (nunca commitar direto na `main`).
4. `npm run type-check` (e `npm run lint`) para validar antes de publicar.
5. Commitar e fazer push da branch.
6. Abrir o **PR** para a `main` — isso dispara o deploy em **UAT** (site/celular).
7. Informar o usuário a URL de UAT do PR.
8. **NÃO** fazer merge aqui — merge é o gatilho de produção (ver `deploy-prod`).
