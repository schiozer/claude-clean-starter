# Runbook: Gate "Spec × código" com Claude (ligar, configurar e desligar)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: Dev

## Objetivo

Ligar (ou desligar) o gate opcional `Spec × código`, que usa o Claude para conferir a spec
declarada no PR contra o diff ([ADR-014](../adr/template/014-release-management.md)). É o único gate
atrás de toggle permanente: desligado (`SPEC_GATE` ausente) não tem custo, não cria check e a
`Guarda da main` não o exige. Os demais gates (`PR gate`, squash, release) valem sempre.

> **Atenção (regra 5)**: use uma conta **pessoal** no console da Anthropic. **Nunca** use chave
> ou assinatura corporativa num repositório pessoal. A chave nunca é colada no chat nem
> impressa por comando.

## Pré-condições

- Workflows `spec-gate.yml` e `pr-gate.yml` presentes na `main`.
- Humano com acesso de admin ao repositório e conta pessoal no console da Anthropic.
- Ciência de que cada PR (e cada mudança de spec/tabela) gasta crédito da chave.

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Ver o estado atual do toggle: `gh variable list --repo <preencher: owner/repo>`.

## Passos

1. [R3] Humano: criar/entrar na conta pessoal no console da Anthropic, adicionar crédito e definir um **limite mensal** de gasto.
   Verificar: o humano confirma que o limite mensal está definido.
2. [R3] Humano: criar a chave de API (nome sugerido: `spec-gate`) e gravá-la como secret `ANTHROPIC_API_KEY` em Settings → Secrets and variables → Actions (nunca colar no chat nem em arquivo).
   Verificar: `gh secret list --repo <preencher: owner/repo>` lista o **nome** `ANTHROPIC_API_KEY` (o valor nunca aparece).
3. [R1] Ligar o gate: `gh variable set SPEC_GATE --body on --repo <preencher: owner/repo>`.
   Verificar: `gh variable list --repo <preencher: owner/repo>` mostra `SPEC_GATE` = `on`.
4. [R1] Opcional, trocar o modelo (default `claude-sonnet-5-5`): `gh variable set SPEC_GATE_MODEL --body <modelo> --repo <preencher: owner/repo>`.
   Verificar: `gh variable list --repo <preencher: owner/repo>` mostra `SPEC_GATE_MODEL`.
5. [R1] Re-rodar o check nos PRs que já estavam abertos ao ligar (ligar não dispara o gate neles): `gh run list --workflow spec-gate.yml --branch <branch>` para achar o `<run-id>` e `gh run rerun <run-id>` ou push/edição da linha `Spec:` no PR.
   Verificar: `gh pr checks <n>` mostra `Spec × código` no PR.
6. [R1] Conferir em um PR de teste (com `Spec:` válida e tabela preenchida).
   Verificar: o check `Spec × código` aparece e há um comentário do `github-actions[bot]` com o resultado e o sha analisado.

## Verificação final

- `gh variable list` mostra `SPEC_GATE=on`; o secret existe; o PR de teste tem o check e o comentário.
- Modos esperados do check: `na` (spec `n/a` aceita), `analyze` (Claude rodou), `reuse` (corpo editado sem mudar `Spec:`/tabela e sha igual ao do comentário), `no-key` (sem chave, ou PR de fork sem secrets: vermelho), `invalid` (linha `Spec:` ausente/inválida, caminho fora de `docs/superpowers/specs`, symlink, não `.md` ou ilegível: vermelho). Saída vazia do Claude ou falha ao preparar também ficam vermelhas.
- O prompt inteiro (spec + diff + tabela + instruções) tem limite de 100 000 bytes UTF-8: o diff é
  cortado primeiro (depois a spec), com aviso; o Claude só lê (Read/Grep/Glob).

## Rollback

1. [R3] Humano: desligar o gate (desligar uma proteção é do humano — regra 10 do `CLAUDE.md`): `gh variable delete SPEC_GATE --repo <preencher: owner/repo>`.
   Verificar: `gh variable list --repo <preencher: owner/repo>` não lista mais `SPEC_GATE`.
2. [R3] Humano: revogar a chave no console da Anthropic e apagar o secret `ANTHROPIC_API_KEY` se não for mais usada.
   Verificar: `gh secret list --repo <preencher: owner/repo>` não lista o secret.

## Registro

Comentário no PR relacionado (`gh pr comment <n> --body-file <arquivo>`) ou issue `ops`: quem
ligou/desligou, data e modelo. Nunca incluir a chave.
