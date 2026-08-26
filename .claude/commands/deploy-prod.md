---
name: deploy-prod
description: Deploy para produção — usar APENAS após aprovação do UAT
---

# Deploy para Produção

> ⚠️ Ajuste os passos ao SEU ambiente (host, branch de produção, URL).
> ⚠️ Só executar após o UAT ser aprovado pelo usuário.

1. Confirmar com o usuário: "Tem certeza que quer deployar para produção?"
2. Verificar se o staging está estável (sem bugs críticos abertos).
3. Garantir a **conta git correta** para este repositório (ver regra 5 do CLAUDE.md).
4. `git status` — garantir árvore limpa e branch correta.
5. Publicar (ex.: merge/push na branch de produção, conforme seu host).
6. Informar que o deploy foi iniciado e sugerir um **smoke test** em produção.
