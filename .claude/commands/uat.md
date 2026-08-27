---
name: uat
description: Executa checklist de UAT e guia os testes do ambiente de staging
---

# UAT — User Acceptance Testing

> ⚠️ Substitua a lista de fluxos pelos do SEU projeto.
> 📄 Ambientes (Dev/UAT/Prod) e como o UAT roda (site/celular): ver [ADR-002](../../docs/adr/002-estrategia-de-ambientes.md).

1. Verificar se o UAT do PR está atualizado (deploy disparado pelo PR aberto).
2. Listar os fluxos a testar (exemplo — troque pelos seus):
   - `FLUXO-01`: <descrição>
   - `FLUXO-02`: <descrição>
3. Perguntar ao usuário qual fluxo testar.
4. Guiar o teste passo a passo.
5. Registrar bugs encontrados como issues.
6. Atualizar o status ao final.

URL de UAT: usar a URL de UAT gerada pelo **PR** (abrir/atualizar PR dispara o
deploy em UAT — ver [ADR-002](../../docs/adr/002-estrategia-de-ambientes.md)).
