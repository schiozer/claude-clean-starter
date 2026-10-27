# Runbook: <preencher: título da operação>

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev, UAT, Prod

> Copie este arquivo para `docs/runbooks/<operacao>.md` e **remova estas instruções**
> (os blocos `>`). Regras em [ADR-013](../adr/template/013-governanca-operacional-e-runbooks.md).
> `Ambientes` lista só os ambientes onde o runbook se aplica (`Dev`, `UAT`, `Prod`).
> Valide com `npm run check:runbooks`.

## Objetivo

> Uma ou duas frases: o que a operação faz e quando usá-la.

## Pré-condições

> O que precisa ser verdade antes de começar (PR aberto, UAT aprovado, acesso ao
> dashboard…). Lista simples, sem classe de risco.

- <preencher: pré-condição>

## Pre-flight

> Checagens de identidade (R0) **antes** de qualquer mutação: conta `gh`, scope Vercel,
> projeto/branch Neon, tenant Auth0 — com os valores reais do projeto. Divergência → para.

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>`.
2. [R0] Conferir o scope Vercel: `vercel project ls --scope <preencher: team Vercel>` lista `<preencher: projeto>`.

## Passos

> Cada item numerado: `[R0]`–`[R3]` + ação + comando, e uma linha indentada `Verificar:`
> com o comando/observação e o resultado esperado. `[R3]` sempre começa com `Humano:`
> (o agente entrega a instrução e espera a confirmação). Exemplos de cada classe:

1. [R0] Ler o estado atual: `vercel ls --scope <preencher: team Vercel>`.
   Verificar: o último deploy está `Ready`.
2. [R1] Mutação reversível fora de Prod: `<comando>`.
   Verificar: `<comando>` → `<esperado>`.
3. [R2] Mutação de alto impacto (Prod, segredo, destrutiva): `<comando>` — pedir aprovação (ADR-013 §3).
   Verificar: `<comando>` → `<esperado>`.
4. [R3] Humano: executar `<ação proibida ao agente>` e avisar quando terminar.
   Verificar: `<comando R0>` → `<esperado>`.

## Verificação final

> Como saber que a operação inteira deu certo (smoke test, URL, checagem no dashboard).

- <preencher: verificação>

## Rollback

> Como desfazer, do menos ao mais invasivo. Mesmos gates dos Passos.

1. [R2] Desfazer: `<comando>`.
   Verificar: `<comando>` → `<esperado>`.

## Registro

> Onde registrar a execução (ADR-013 §5): comentário no PR (`gh pr comment`) ou issue com
> label `ops`. Sem segredos.

Comentário no PR relacionado (`gh pr comment <n> --body-file <arquivo>`) ou issue `ops`.
