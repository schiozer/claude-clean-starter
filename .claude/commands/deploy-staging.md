---
name: deploy-staging
description: Push das mudanças para o ambiente de staging/UAT
---

# Deploy para Staging

> ⚠️ Ajuste a estratégia de branch/host ao SEU ambiente.

1. `git status` — verificar mudanças pendentes.
2. Se houver mudanças não commitadas, perguntar se deve commitar.
3. `npm run type-check` (e `npm run lint`) para validar antes de publicar.
4. Publicar no ambiente de **staging/UAT** (ex.: push para a branch/preview
   configurada no seu host).
5. Informar o usuário que o deploy foi iniciado.
6. **NÃO** publicar em produção neste comando.
