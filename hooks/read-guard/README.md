# read-guard

Hook `PreToolUse` da ferramenta `Read`. Um arquivo lido inteiro entra no contexto e volta a cada
turno pelo cache; uma leitura descuidada é paga muitas vezes.

| Caso                                     | Decisão | Dica na mensagem                                             |
| ---------------------------------------- | ------- | ------------------------------------------------------------ |
| texto > 60 KB, sem `offset`/`limit`      | nega    | `rg -n` para localizar, `Read` com offset/limit ou subagente |
| PDF ≥ 1 MB, sem `pages`                  | nega    | `pdftotext -layout`, ou repetir o Read com `pages`           |
| leitura com fatia, pequena, ausente, img | libera  | (sem saída)                                                  |

Imagens (`png`, `jpg`, `gif`, `webp`, `svg`) e notebooks (`ipynb`) nunca são bloqueados. Qualquer
erro = sem opinião (fail-open).

- Desligar: `READ_GUARD=off` (no `env` pessoal ou para um shell).
- Limites: `TEXT_MAX_BYTES` e `PDF_MAX_BYTES` no topo de `evaluate.mjs`.
- Política: [guia de modelo, esforço e tokens](../../docs/guides/model-effort-tokens-guide.md).
- Testes: `tests/unit/readGuard.test.ts`.
