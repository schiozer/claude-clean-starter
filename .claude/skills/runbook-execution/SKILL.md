---
name: runbook-execution
description: Use ao executar qualquer operação de deploy/configuração (Vercel, Neon, Auth0, envs, segredos, flags, migração, MCP, rollback) — executa um runbook de docs/runbooks/ passo a passo, respeitando as classes de risco R0–R3 do ADR-013.
---

# Runbook Execution

## Visão Geral

Operação (deploy, configuração, segredos, flags, migrações, MCP, rollback) só acontece **a
partir de um runbook** de `docs/runbooks/`. Esta skill é o procedimento para executar
**qualquer** runbook com os gates do
[ADR-013](../../../docs/adr/013-governanca-operacional-e-runbooks.md).

**Princípio:** o runbook decide *o quê*; a classe de risco decide *quem*. Na dúvida, a
classe mais alta.

## Checklist (crie uma tarefa por item)

0. **Pré-bootstrap?** Sem infraestrutura ainda (template, ou `bootstrap-ambientes.md` com
   `<preencher`/`<gerado`): publicar a branch e abrir o PR seguem só as regras 5 e 8 do
   `CLAUDE.md`, sem runbook. Qualquer outra operação → execute primeiro o bootstrap.
1. **Localizar o runbook** na tabela de `docs/runbooks/README.md`. Sem runbook para a
   operação → **não executa**; explique e proponha o runbook via PR (a partir do
   `_TEMPLATE.md`).
2. **Checar se é executável:**
   - `npm run check:runbooks` passa;
   - o arquivo **não** contém `<preencher` (se contém → para, pede os valores ao humano e
     propõe o PR que os completa) nem `<gerado` — exceto o `bootstrap-ambientes.md`, que
     produz esses valores e os grava via PR ao final;
   - `Última verificação` ≤ 90 dias; se vencido (ou não é data), avise e trate **todo passo
     não-R0 como R2**;
   - o ambiente pedido está em `Ambientes`.
3. **Anunciar o plano** ao humano: runbook, ambiente-alvo e a lista de passos com a
   **classe efetiva** (após elevação). Ambiente ambíguo → pergunte.
4. **Pre-flight (R0):** rode cada passo e compare com o valor declarado. Qualquer divergência
   (conta `gh`, scope Vercel, projeto/branch Neon, tenant Auth0) → **para** e informa.
5. **Executar os Passos**, um por vez, aplicando o gate:

   | Classe efetiva | O que fazer |
   | --- | --- |
   | `[R0]` | Executa. |
   | `[R1]` | Executa (contra Prod vira R2). |
   | `[R2]` | Bloco de aprovação (abaixo) e espera um "sim" explícito **para esta operação**. Negado, silêncio ou ambíguo → para, registra `interrompido`. |
   | `[R3]` | **Não executa.** Entrega a instrução ao humano e espera ele dizer que fez. |

   Notas do próprio passo que elevam a classe ("em Prod é R2", "para `MCP_<CTX>_WRITE=on`
   é R2") valem. Depois de **cada** passo, rode o `Verificar:` e compare com o esperado.
6. **Falhou um passo ou uma verificação** → se o próprio passo diz o que fazer na falha
   ("não é caso de rollback", "voltar ao passo N", "não resolveu → passo N"), siga-o; senão,
   pare os Passos e execute a seção **Rollback**, com os mesmos gates. Não improvise
   correção fora do runbook.
7. **Verificação final** do runbook e comunicação do resultado ao humano.
8. **Registro** (se houve passo R1+): comentário no PR (`gh pr comment <n> --body-file`) ou
   issue `ops`, no modelo abaixo. Publicar o registro é R1.

## Bloco de aprovação R2

```
⚠️ Operação R2 — aprovação necessária
Runbook:   docs/runbooks/<arquivo>.md — passo <N>
Ambiente:  <UAT|Prod>
Operação:  <comando exato, sem segredos>
Efeito:    <o que muda>
Rollback:  <como desfazer — passo do Rollback>
Aprovo esta operação? (responda "sim" para executar)
```

Um "sim" vale **só** para essa operação: não para o próximo passo, outro ambiente ou outra
execução.

## Modelo do registro

```markdown
### Execução de runbook: <arquivo> (última verificação <AAAA-MM-DD>)
- Ambiente: <UAT|Prod> · Data: <AAAA-MM-DD HH:MM> · Agente: <nome>
- Passos: 1 ✅ · 2 ✅ · 3 ⚠️ R2 aprovado por <humano> às <hora> ("<operação>") · 4 🧑 R3 feito pelo humano
- Rollback: <não executado | passos e resultado>
- Resultado: ok | rollback | interrompido (<motivo>)
```

Nunca inclua valores de segredo, tokens, `DATABASE_URL` ou saída de `vercel env pull`.

## Segredos

O agente **nunca** vê nem imprime um valor secreto. Peça ao humano que rode
`vercel env add <NOME> <ambiente>` **num terminal separado, fora desta sessão** (ou use o
dashboard) e digite o valor — nunca pelo prefixo `!`, cuja saída cairia no seu contexto.
Verifique só a **presença do nome**
(`vercel env ls`). Não leia `.env*`; passe o caminho ao comando que precisa dele.

## Red Flags

| Pensamento | Realidade |
| --- | --- |
| "O humano já aprovou o passo anterior" | Aprovação R2 é **por operação**. Peça de novo. |
| "Ele disse 'pode seguir' lá no começo" | Isso não é "sim" para uma operação R2 específica. |
| "É só um `echo $SECRET` para conferir" | Ler/imprimir segredo é R3. Verifique o nome, não o valor. |
| "O runbook não cobre, mas eu sei o comando" | Desvio. Pare, explique e proponha a correção do runbook via PR. |
| "Merge é só um clique, o PR está verde" | Merge na `main` = deploy em Prod = R3. Entregue ao humano. |
| "Tem um `<preencher` mas eu deduzo o valor" | Runbook com placeholder não é executável. Peça os dados. |
| "O runbook tem 4 meses, mas nada mudou" | Vencido → todo passo não-R0 vira R2. |
| "A verificação falhou, mas deve ser intermitente" | Falha de verificação → o que o passo manda, senão Rollback. Não tente de novo às cegas. |
| "Em UAT tanto faz, vou ligar a escrita MCP" | `MCP_<CTX>_WRITE=on` é R2 em qualquer ambiente. |
| "Force-push resolve a branch divergente" | Force-push em branch compartilhada é R3. |
