---
name: deploy-prod
description: Merge do PR na main — dispara o deploy em produção (APENAS após UAT aprovado)
---

# Deploy para Produção — via merge do PR

> ⚠️ Ajuste os passos ao SEU ambiente (host, branch de produção, URL).
> ⚠️ Só executar após o UAT ser aprovado pelo usuário.
> 📄 Ambientes (Dev/UAT/Prod): ver [ADR-002](../../docs/adr/002-estrategia-de-ambientes.md).
> 🔒 Promove-se o mesmo commit da trunk aprovado em UAT; **o merge é o gatilho de
> produção** (ver [ADR-005](../../docs/adr/005-trunk-based-development.md)).

O deploy em produção é **disparado pelo merge do PR na `main`**. Não há push
manual para prod.

1. Confirmar com o usuário: "Tem certeza que quer fazer merge e deployar para produção?"
2. Confirmar que o **UAT do PR foi aprovado** (sem bugs críticos abertos).
3. Garantir a **conta git correta** para este repositório (ver regra 5 do CLAUDE.md).
4. Garantir que o PR está verde (type-check, lint, testes) e a branch atualizada com a `main`.
5. **Fazer merge do PR na `main`** — isso dispara o deploy em **produção**.
6. Informar que o deploy foi iniciado e sugerir um **smoke test** em produção.
