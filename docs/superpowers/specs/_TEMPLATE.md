# Spec: <Nome da Feature>

**Data**: AAAA-MM-DD
**Status**: Rascunho | Aprovada (só com os cenários da seção 8 revisados pela QA)
**Autor(es)**: <nome>

> Produzida pela skill `superpowers:brainstorming`. É o **contrato** para o plano
> e a implementação. Preencha cada seção; remova as que não se aplicam.

## 1. Contexto e Objetivo

Qual problema resolvemos e para quem? Qual o resultado esperado?

## 2. Não-Objetivos

O que explicitamente **fora de escopo** nesta feature.

## 3. Fluxo do Usuário

Passo a passo do que o usuário faz e vê (happy path + principais desvios).

## 4. Componentes / Telas

Componentes de UI, rotas e responsabilidades.

## 5. Regras de Negócio

Regras, invariantes e validações (Zod). Casos-limite.

## 6. Dados / Queries

Entidades, campos, relações e as principais consultas/mutações.

## 7. Requisitos não funcionais

O projeto tem um **baseline** de RNF e usabilidade em [`docs/rnf.md`](../../rnf.md) (tempo de
resposta, timeouts, sessão, segurança, acessibilidade), testado em toda tela e rota sem que a spec
precise repetir nada. Aqui entra **só o que foge do baseline**, um item por linha, com ID
`RNF-<CAT>-NNN` (a categoria e o número seguem o `docs/rnf.md`), o valor desta feature e o do
baseline:

- Ex.: RNF-TMO-010: o upload aceita até 30 s (baseline: 10 s).

Cada desvio declarado aqui precisa de um teste com o mesmo ID. Se nada foge, escreva
**"Segue o baseline."**

## 8. Cenários de teste

Um bloco por cenário, em português, no formato Dado/Quando/Então. O Claudinho rascunha os
cenários a partir do fluxo do usuário (§3), das regras de negócio (§5) e dos RNF (§7); a **QA lê e
ajusta** aqui mesmo antes de a spec passar a `Aprovada`. Cada cenário vira um teste Playwright com
o mesmo ID, e o `npm run check:cenarios` confere os dois lados.

```markdown
### CT-<CTX>-001 — Publicar um recurso com itens

Tipo: @e2e Destino: @regressao @doc @demo
Critério: CA-2 Perfil: usuário final

Dado que estou logado e tenho o recurso "Plano de estudos" com 2 itens
Quando abro a lista de recursos
E publico o recurso "Plano de estudos"
Então vejo o selo "Publicado" no recurso
E o recurso aparece para os outros membros do time
```

> Na spec real, o bloco fica **fora** de cerca de código, com o heading `###` direto na seção.
> Exemplo completo: `examples/walking-skeleton/docs/specs/resources.md`.

**Regras do bloco**

- **ID** `CT-<CTX>-NNN`: `<CTX>` é a sigla do módulo/contexto (2 a 6 letras maiúsculas, ex.:
  `RES`); o número é sequencial **por contexto no projeto** e **nunca é reutilizado** — cenário
  removido fica com o ID aposentado (`Aposentado: <motivo>`). O ID liga o cenário ao teste, à
  documentação e aos vídeos.
- **Tipo** (exatamente um): `@e2e` (pelo navegador), `@sistemico` (API REST/MCP, sem navegador),
  `@rnf` (desvio do baseline) ou `@usabilidade` (teclado, acessibilidade, estados).
- **Destino** (zero ou mais): `@regressao` (suíte permanente), `@doc` (gera a página de ajuda),
  `@demo` (vídeo da versão), `@treinamento` (vídeo da trilha de treinamento). `@regressao` é o
  padrão de todo cenário: tirar um cenário da regressão exige a linha
  `Fora da regressão: <motivo>`.
- **Critério**: um ou mais `CA-n` da seção "Critérios de Aceitação".
- **Perfil**: quem aparece no material gerado — `usuário final` ou `time interno`.
- **Passos**: cada linha começa por `Dado`, `Quando`, `Então`, `E` ou `Mas`. Dados de exemplo vão
  entre aspas e são fictícios e apresentáveis ("Plano de estudos"), nunca dados reais. O texto do
  passo é a chave do teste (`jornada()`): mudou aqui, muda lá — acentos, aspas e maiúsculas contam.
- **Teste**: o título começa pelo ID e as tags são exatamente o tipo mais os destinos, com o
  `@regressao` implícito escrito por extenso:

  ```typescript
  test('CT-<CTX>-001 publicar recurso com itens', { tag: ['@e2e', '@regressao', '@doc', '@demo'] }, …)
  ```

**Cobertura mínima por feature** — toda feature com tela ou rota nova tem, no mínimo:

- 1 cenário `@e2e` do caminho feliz **por critério de aceitação**;
- 1 cenário de **erro funcional** (regra de negócio recusada, mostrada como aviso — ADR-009);
- 1 cenário `@sistemico` **por rota ou tool MCP nova**, incluindo o 401/403 (fail-closed);
- os cenários de `@usabilidade` do baseline (`docs/rnf.md`), que já rodam em toda tela listada lá.

Feature só de backend dispensa `@e2e` e `@usabilidade`; escreva o motivo aqui.

## 9. Critérios de Aceitação

Lista objetiva e verificável do que significa "pronto", um critério por linha com ID `CA-n`
(sequencial na spec), citado pelos cenários da seção 8:

- **CA-1**: <critério verificável>
- **CA-2**: <critério verificável>

## 10. Itens Futuros

Ideias adjacentes deliberadamente adiadas.
