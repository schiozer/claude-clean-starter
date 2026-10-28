# 015. Template sync: projetos puxam o template por PR, em três vias

**Data**: 2026-10-27
**Status**: Aceito

## Contexto

O template evolui (proteção da `main`, runbooks, gates, gestão de releases…), mas os projetos
criados a partir dele não recebem essas melhorias. Trazer à mão dá trabalho e dá medo de
sobrescrever o que o projeto mudou. Um levantamento nos projetos derivados mostrou:

- Cada projeto saiu do template num ponto diferente. Um deles é a **origem** do template:
  o template nasceu dele, evoluiu, e ele nunca recebeu a evolução.
- Arquivos "do template" (`ci.yml`, `package.json`, `eslint.config.mjs`, `CLAUDE.md`) foram
  mudados em **todos** os projetos. "Os dois lados mudaram" é a regra, não a exceção.
- **Os números dos ADRs colidem**: os ADRs 010–014 do template têm, nos projetos, os mesmos
  números com outros assuntos.
- Há melhorias nos projetos que deviam estar no template. Há também decisões que o template já
  tem, reescritas à mão em vários projetos com números diferentes.

## Decisão

1. **Cada projeto puxa o template, sempre por PR.** A skill `template-sync`
   (`.claude/skills/template-sync/SKILL.md`) roda no projeto (modo `sync`). Ela clona o template
   na **Release mais nova** (tag `vX.Y.Z`, [ADR-014](./014-release-management.md)) e roda o
   motor e a skill **daquela versão**. O resultado é um PR `chore(template): sync vX → vY`. O
   merge é do humano. O template nunca empurra nada e não tem credencial de escrita nos
   projetos.
2. **Comparação em três vias.** A base é o template no `lastSync` do `.template-sync.json`
   (versionado no projeto). O alvo é a Release. O projeto é o HEAD. O motor
   (`scripts/template-sync.mjs`) classifica cada arquivo e age assim:

   | Situação do arquivo                              | O que o motor faz                                                                                  |
   | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
   | Só o template mudou                              | Aplica                                                                                             |
   | Os dois já estão iguais                          | Nada                                                                                               |
   | Os dois mudaram                                  | Junta com `git merge-file`; um conflito é resolvido pelo Claude, preservando a intenção do projeto |
   | Arquivo novo ou apagado que colide com o projeto | Pergunta ao humano                                                                                 |
   | Caminho em `projectOwned`                        | Nunca toca                                                                                         |

   O `lastSync` novo entra no mesmo PR, e o que já foi decidido não volta.

3. **O manifesto define o que é do template.** O arquivo é `template-sync.manifest.json`, com
   as listas `managed` e `ignore`. Um caminho é do template se algum dos manifestos (base ou alvo, cada um com o próprio `ignore`) o gerencia.
   Fora do manifesto nada é tocado. A única exceção são links para ADRs do template que
   mudaram de lugar; cada arquivo reescrito é listado no PR. O motor também cuida de três
   casos:
   - detecta renomes só entre caminhos do template (e a ida dos ADRs para `docs/adr/template/`);
   - valida o JSON depois da junção;
   - aponta no PR os itens que só existem por causa de `examples/`, sem nunca removê-los.
4. **Os ADRs do template ficam em `docs/adr/template/`**, no mesmo caminho no template e nos
   projetos. `docs/adr/NNN-*.md` é do projeto, com numeração livre. Na adoção, um ADR do
   projeto que copia um ADR do template é proposto para remoção.
5. **A adoção começa na sessão do template** (`/template-sync adotar <caminho>`). O motor
   propõe como base o commit do template com mais arquivos idênticos ao projeto, ou "sem base"
   no caso do projeto que deu origem ao template.
6. **Contribuir** leva uma melhoria do projeto ao template por PR. Antes, a skill generaliza o
   conteúdo e roda `check-agnostic` (sem nome de projeto, conta, repo ou segredo).
7. **Status e aviso ficam fora dos arquivos versionados do template.**
   - A lista de projetos fica em `~/.config/template-sync/projects.json`, na máquina do humano.
   - O relatório é uma issue fixada com o rótulo `template-status` no repo do template.
   - Cada projeto roda toda semana o workflow `template-sync-check.yml`. Ele mantém **uma**
     issue `template-sync` com as notas das Releases que faltam e a fecha quando o projeto
     está em dia.
8. **Sem feature toggle**: a skill só roda quando é chamada, e o aviso é só uma issue.

## Consequências

- ✅ Um projeto recebe as melhorias sem perder o que mudou. Um segundo sync logo depois do
  primeiro não tem nada a fazer.
- ✅ Os números de ADR param de colidir. Template e projetos evoluem os seus ADRs de forma
  independente.
- ✅ O template continua agnóstico: nenhum arquivo dele cita projetos ou contas.
- ⚠️ O motor resolve texto, não semântica. Os conflitos dependem do julgamento do Claude e da
  revisão do PR pelo humano.
- ⚠️ O projeto precisa rodar o sync, e o aviso semanal só lembra. Um template privado exigiria
  um token de leitura no workflow de aviso (item futuro).
- ⚠️ O manifesto lista os testes do template um a um em `tests/unit/`, porque os testes do app
  moram na mesma pasta. Um teste novo do template precisa entrar no manifesto.

## Alternativas Consideradas

- **O template empurra PRs para os projetos**: exigiria uma credencial do template com escrita
  em cada projeto e um registro versionado dos projetos, o que fere o template agnóstico.
  Descartada.
- **Sync por data ("o que mudou desde o dia X")**: não distingue o que o projeto já decidiu e
  ofereceria de novo mudanças recusadas. Uma tag de Release mais o commit do `lastSync` dão uma
  base exata e à prova de tag movida. Descartada.
- **`git merge` de um remote `template`**: as histórias não têm ancestral comum. O merge traria
  `examples/`, specs e planos do template, e a colisão de ADRs viraria conflito em massa.
  Também não há como dizer "este arquivo é do projeto". Descartada.
