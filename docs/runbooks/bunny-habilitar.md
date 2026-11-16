# Runbook: Habilitar vídeos de demo e treinamento (Bunny)

**Responsável**: <preencher: pessoa/time>
**Última verificação**: AAAA-MM-DD
**Ambientes**: UAT, Prod

## Objetivo

Ligar o job `Demos & Treinamento` (`.github/workflows/demos-treinamento.yml`,
[ADR-017](../adr/template/017-bunny-videos-demos-treinamento.md)) e os vídeos na `/ajuda`: library
no Bunny Stream, storage zone com pull zone para o catálogo, segredos `BUNNY_*` no GitHub, chave de
embed assinado e envs do app na Vercel, e os toggles `DEMOS_BUNNY`. Use uma vez por projeto e de
novo ao rotacionar qualquer credencial do Bunny.

> **Opcional**: sem este runbook, `DEMOS_BUNNY` fica desligado (padrão), o job termina verde com
> aviso e a `/ajuda` mostra só a documentação. Não vai usar vídeos? Apague o runbook e a linha do
> catálogo, para o `--strict` não cobrar os `<preencher>` dele.

> **Segredos (ADR-013 §4)**: chaves e senhas do Bunny são digitadas **pelo humano, num terminal
> separado, fora da sessão do agente** (ou no dashboard). O agente nunca vê, ecoa ou passa valor
> em argumento, nem cola valor no chat; só confere **nomes**.

## Pré-condições

- Conta no Bunny com acesso a Stream e Storage: `<preencher: conta/time no Bunny>`.
- Pelo menos uma Release (tag `vX.Y.Z`) criada pelo workflow `Release`.
- Humano com admin no repositório e no host do `deploy.config.json`.
- `bootstrap-ambientes.md` executado (host com UAT e Prod existentes).
- O `playwright.config.ts` do projeto envolve a config com `modoDemos` (`defineConfig(modoDemos({ ... }))`, de `tests/e2e/support`) — ver a [Adoção do guia de E2E](../guides/e2e-guide.md#adoção). Sem ele, o `demos:gravar` não escreve o manifesto e o `demos:publicar` falha com "manifesto ausente".

## Pre-flight

1. [R0] Conferir a conta `gh` ativa: `gh auth status --active` → `<preencher: conta do repo>` (regra 5 do `CLAUDE.md`).
2. [R0] Conferir a conta e o projeto do host: Pre-flight do runbook do host do `deploy.config.json` (host-<host>.md).
3. [R0] Ver o estado atual: `gh variable list --repo <preencher: owner/repo>` e `gh secret list --repo <preencher: owner/repo>` (só nomes); `DEMOS_BUNNY` não deve estar `on`.

## Passos

1. [R1] No Bunny Stream, criar a **library** `<preencher: nome da library>` e anotar o `BUNNY_LIBRARY_ID` (número da library).
   Verificar: o humano confirma a library no painel e o ID anotado.
2. [R1] No Bunny Storage, criar a **storage zone** `<preencher: nome da storage zone>` (anotar o nome, `BUNNY_STORAGE_ZONE`, e — só se a zona for regional — o host, `BUNNY_STORAGE_HOST`) e uma **pull zone** ligada a ela (a URL da CDN será `<preencher: https://cdn do catálogo>`).
   Verificar: a pull zone aparece ligada à storage zone no painel.
3. [R1] Na pull zone, criar uma **Edge Rule** de cache de 60 s para `*/catalogo/index.json` (o índice muda a cada versão; os `vX.Y.Z.json` são imutáveis).
   Verificar: a regra aparece listada na pull zone.
4. [R2] Gravar os segredos no GitHub: para cada nome, o humano roda `gh secret set <NOME> --repo <preencher: owner/repo>` num terminal separado e digita o valor no prompt: `BUNNY_STREAM_API_KEY`, `BUNNY_LIBRARY_ID`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD` e, **opcional** (só para storage zone regional; o padrão é `storage.bunnycdn.com`), `BUNNY_STORAGE_HOST`.
   Verificar: `gh secret list --repo <preencher: owner/repo>` lista os quatro **nomes** obrigatórios, mais `BUNNY_STORAGE_HOST` se usado (o valor nunca aparece).
5. [R2] Habilitar o **token authentication** da library (exigido pelo perfil `time interno`) e gravar a chave `BUNNY_STREAM_TOKEN_KEY` como segredo em Prod (e no UAT, se o UAT mostrar vídeo) pelo passo de segredo do bloco **Segredos e envs** do runbook do host — o humano digita o valor no prompt ([segredos-e-env.md](./segredos-e-env.md)). O token auth vale para a **library toda**: ligado, o app assina **todo** embed (inclusive `usuário final`) e os links das notas da Release (não assinados) deixam de tocar — o caminho para assistir passa a ser a `/ajuda`. Sem a chave (token auth desligado), os itens do `time interno` são omitidos e os de `usuário final` saem públicos.
   Verificar: a listagem de nomes do bloco **Segredos e envs** do runbook do host mostra `BUNNY_STREAM_TOKEN_KEY`.
6. [R1] Ligar o app no UAT, pelo passo de env não-secreta do bloco **Segredos e envs** do runbook do host: `DEMOS_BUNNY` com `on` e `BUNNY_CATALOGO_URL` com `<preencher: https://cdn do catálogo>/catalogo/index.json`. Em Prod (e, no Heroku e no Cloud Run, em qualquer ambiente) vira R2. Depois, redeploy do ambiente ([segredos-e-env.md](./segredos-e-env.md), passo 3).
   Verificar: a listagem de nomes do bloco mostra os dois nomes.
7. [R1] Ligar o job: `gh variable set DEMOS_BUNNY --body on --repo <preencher: owner/repo>`.
   Verificar: `gh variable list --repo <preencher: owner/repo>` mostra `DEMOS_BUNNY` = `on`.

## Verificação final

- Disparar o job com a última tag: `gh workflow run demos-treinamento.yml --repo <preencher: owner/repo> -f tag=<última tag vX.Y.Z>` e acompanhar com `gh run watch` (verde, com o passo `Publicar no Bunny` executado).
- Conferir o catálogo pela CDN: `curl -s <preencher: https://cdn do catálogo>/catalogo/index.json` traz a versão publicada em `versoes`.
- Abrir a `/ajuda` do ambiente (cache de até 300 s): o vídeo aparece; sem catálogo, a página mostra "Vídeos indisponíveis no momento." e mantém a documentação.
- A Release da tag tem a seção com os links das demos (só `usuário final`; com token auth ligado, assista pela `/ajuda`).

## Rollback

1. [R1] Desligar o job: `gh variable delete DEMOS_BUNNY --repo <preencher: owner/repo>`.
   Verificar: `gh variable list --repo <preencher: owner/repo>` não lista `DEMOS_BUNNY`.
2. [R1] Desligar o app: remover `DEMOS_BUNNY` do UAT pelo passo de remover env do bloco **Segredos e envs** do runbook do host (em Prod, e no Heroku e no Cloud Run, R2). Redeploy. A `/ajuda` volta a mostrar só a documentação.
   Verificar: a listagem de nomes do bloco não mostra `DEMOS_BUNNY` e a `/ajuda` não mostra vídeos.
3. [R2] Se as credenciais não forem mais usadas: o humano revoga as chaves no Bunny e o agente pede a remoção dos segredos (`gh secret delete <NOME> --repo <preencher: owner/repo>`, um por aprovação).
   Verificar: `gh secret list --repo <preencher: owner/repo>` não lista mais os nomes removidos.

> As coleções e os vídeos antigos **ficam no Bunny** até serem apagados pelo painel; desligar não
> apaga nada.

## Registro

Comentário no PR ou issue `ops`: runbook + `Última verificação`, **nomes** dos segredos e envs
criados, aprovações R2, resultado do `workflow_dispatch` e da `/ajuda`. Nunca valores.
