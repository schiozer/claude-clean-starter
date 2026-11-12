# 017. Vídeos de demo e treinamento gravados pelo Playwright e publicados no Bunny

**Data**: 2026-11-12
**Status**: Aceito

## Contexto

O [ADR-016](./016-testes-e2e-nascidos-da-spec.md) deixou as tags `@demo` e `@treinamento` na spec
sem consumidor. Agora a mesma jornada que vira teste e documentação também vira **vídeo**: uma
demo por versão e um treinamento sempre atual.

O vídeo é **escrito no merge** (depois que a `main` recebe o PR e a Release cria a tag), e a
`main` só recebe mudança por PR (regra 0 do `CLAUDE.md`). Logo, nem o vídeo nem o catálogo que o
aponta podem morar no git. Além disso:

- gravar contra o UAT ou Prod é proibido: depois do merge o alias pode apontar para outro preview e
  nenhum dado real pode aparecer;
- a `/ajuda` nunca pode quebrar por causa do vídeo;
- vídeo do `time interno` não pode ser público.

## Decisão

1. **Bunny Stream** é a plataforma de vídeo, atrás da interface `IVideoHost` (`upload`,
   `ensureCollection`, `replaceCollection`, `embedUrl`), com a implementação `BunnyStreamVideoHost`
   e um fake em memória nos testes (mesmo isolamento do Neon e do Auth0).
2. **Catálogo versionado no Bunny Storage**, servido pela CDN: um arquivo imutável por versão
   (`catalogo/vX.Y.Z.json`) e o `catalogo/index.json`, **gravado por último**. Uma publicação que
   falha no meio nunca deixa o índice apontando para vídeo ausente. O workflow usa `concurrency`
   sem cancelar para duas gravações não disputarem o índice.
3. **Embed conforme o perfil**: público para `usuário final`; **assinado** (token authentication do
   Bunny, URL assinada no servidor com `BUNNY_STREAM_TOKEN_KEY`) para `time interno`. Sem a chave,
   esses itens são omitidos (fail-closed).
4. **Toggle `DEMOS_BUNNY`** ([ADR-006](./006-processo-de-feature-e-feature-toggle.md)), nascendo
   **desligado**: variável do repositório (workflow) e env do app (a `/ajuda`). Desligado, o job
   termina verde com aviso e a ajuda mostra só a documentação.
5. **Gravação contra o app da tag**: o job `Demos & Treinamento` (`workflow_run` do `Release`, ou
   `workflow_dispatch` com a tag) constrói o app no runner a partir do commit da tag e roda
   `npm run demos:gravar` (`video: 'on'`, `slowMo`, legenda sobreposta, desktop e mobile). Demos =
   cenários `@demo` da spec do PR da versão (coleção `vX.Y.Z`); treinamento = todos os
   `@treinamento`, em trilhas por perfil, com a coleção substituída a cada versão.
6. A `/ajuda` lê o índice com cache de 300 s e timeout de 3 s. Sem catálogo ou com falha, mostra
   "Vídeos indisponíveis no momento." e mantém a documentação.
7. Segredos `BUNNY_*` só no GitHub e na Vercel, configurados pelo runbook
   [`bunny-habilitar.md`](../../runbooks/bunny-habilitar.md) (R2).

## Consequências

- **Mais fácil**: vídeo sempre reflete o código da versão, sem dado real; trocar de provedor de
  vídeo é trocar a implementação de `IVideoHost`; a falha de vídeo não afeta merge, Release nem
  ajuda.
- **Mais difícil**: mais um fornecedor, segredos e custo (Bunny); o catálogo fora do git não tem
  histórico em PR; coleções antigas ficam no Bunny até serem apagadas pelo painel.
- **Dívida**: tratamento do vídeo (cortes, conversão) fica por conta da transcodificação do Bunny.
  Falha na publicação deixa o job vermelho e avisa a Release; a recuperação é rodar o
  `workflow_dispatch` de novo com a tag.

## Alternativas Consideradas

- **YouTube não listado**: o link vaza com facilidade, não há assinatura por perfil (o vídeo do
  `time interno` ficaria exposto) e o player/marca não são controláveis.
- **S3 + CloudFront**: exige montar transcodificação, player, URLs assinadas e coleções por conta
  própria; mais infraestrutura para o mesmo resultado que o Bunny entrega pronto.
- **Commitar os vídeos no git**: a `main` só recebe PR (o vídeo nasce depois do merge), o
  repositório incharia com binários e não haveria como restringir por perfil.
