## O quê

<!-- O que muda neste PR, em poucas linhas. -->

## Por quê

<!-- Motivação: problema, requisito ou decisão que levou a esta mudança. -->

Spec: <caminho ou n/a — motivo>

<!-- Uma linha `Spec:`. Com spec: `Spec: docs/superpowers/specs/<arquivo>.md`. Sem spec: `Spec: n/a — <motivo>` (recusado para feat, refactor e títulos com `!`). -->

## Spec × código

<!-- Preenchida pelo autor. Status: ok | parcial | fora. -->

| Critério (seção "Critérios de Aceitação" da spec) | Onde é atendido (arquivo/teste) | Status |
| ------------------------------------------------- | ------------------------------- | ------ |
|                                                   |                                 |        |

## Checklist

- [ ] Código segue BEST_PRACTICES.md
- [ ] Validação Zod nos formulários / bordas
- [ ] Erros tratados (mensagens user-friendly)
- [ ] Autorização no servidor (se nova entidade/rota)
- [ ] Tool MCP (se exposta): `scope` + anotações + flag (escrita desligada por padrão)
- [ ] Responsivo (se UI)
- [ ] Loading states
- [ ] TypeScript sem `any`
- [ ] Sem `console.log`/`debugger`
- [ ] Linter sem warnings (`npm run lint`)
- [ ] Type-check ok (`npm run type-check`)
- [ ] Testes passando (`npm test`)
- [ ] Testado manualmente (happy path + 1 erro)

## UAT

<!-- O UAT é marcado SÓ pelo humano, depois de testar no ambiente de UAT. Marque exatamente uma opção. -->

- [ ] UAT aprovado
- [ ] UAT não se aplica — <motivo>
