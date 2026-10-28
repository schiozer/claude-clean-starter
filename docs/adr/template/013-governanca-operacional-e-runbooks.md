# 013. Governança operacional: runbooks e classes de risco para agentes

**Data**: 2026-10-11
**Status**: Aceito

## Contexto

Os ADRs 002–012 definem **como o sistema se comporta** em cada ambiente (Dev local / UAT /
Prod), como o banco ([ADR-003](./003-banco-por-ambiente-neon.md)) e a auth
([ADR-004](./004-auth-por-ambiente-auth0.md)) se separam por ambiente, como as features
nascem atrás de flags ([ADR-006](./006-processo-de-feature-e-feature-toggle.md)), como
migrações são aplicadas ([ADR-008](./008-migracoes-sql-versionadas-driver-http.md)) e como o
MCP é exposto ([ADR-012](./012-mcp-como-borda-agentica.md)). Nenhum deles define **quem pode
fazer o quê** na operação — e cada vez mais quem opera (deploy, envs, flags, migrações,
Auth0, rollback) é um **agente**.

Sem regra explícita, o agente ou trava em tudo (pede permissão para listar envs) ou faz
demais (merge na `main` = deploy em Prod, rotaciona segredo sozinho, imprime `DATABASE_URL`
no chat). Este repositório é um **template** sem infraestrutura própria: o que ele pode
entregar são as **regras** e um **catálogo de runbooks** que todo projeto adotado herda e é
obrigado a completar.

## Decisão

### 1. Operação só via runbook

Toda operação de deploy/configuração é executada **a partir de um runbook** de
`docs/runbooks/`, pela skill `runbook-execution`. Sem runbook para a operação → o agente
**não executa**; propõe o runbook via PR. O agente não executa comando fora do runbook numa
operação R1+ (se o runbook está errado ou incompleto, para, explica e propõe a correção).

**Exceção pré-bootstrap:** enquanto não há infraestrutura (o template, ou um projeto cujo
`bootstrap-ambientes.md` ainda não foi executado), publicar a feature branch e abrir o PR
seguem só as regras 5 e 8 do `CLAUDE.md`, sem runbook. Nenhum outro passo de operação é
executado nesse estado.

### 2. Classes de risco

Todo passo numerado de Pre-flight, Passos e Rollback leva **exatamente uma** tag:

| Classe | Exemplos | Gate |
| --- | --- | --- |
| `[R0]` leitura | status de deploy, logs, listar envs (só **nomes**), listar flags, `gh pr checks`, smoke test sem credencial | Livre em qualquer ambiente |
| `[R1]` mutação reversível fora de Prod | push de branch / abrir PR (dispara UAT), env var **não-secreta** em Dev/UAT, flag em Dev/UAT (exceto escrita MCP), migração em Dev/UAT (o reset de `dev`/`uat` a partir do pai copiaria dados de Prod — é R2) | Agente executa e **registra** |
| `[R2]` alto impacto | qualquer mutação em Prod; criar/rotacionar/remover **segredo** em qualquer ambiente; migração em Prod; operação destrutiva (drop, delete de branch/projeto/tenant/cliente); ligar **escrita MCP** (`MCP_<CTX>_WRITE`) em qualquer ambiente; ligar DCR em Prod; promover/reverter deploy de Prod | **Aprovação humana explícita por operação** (item 3) |
| `[R3]` proibido ao agente | merge na `main` (= deploy Prod), push direto na `main`, force-push em branch compartilhada, ler/imprimir valor de segredo, desligar proteções (branch protection, required checks, RBAC, Deployment Protection, consentimento do DCR). Push direto/merge na `main` é imposto ao agente pelo hook `hooks/protect-main` | Agente **recusa**; o passo é escrito como instrução ao humano (`[R3] Humano: …`) |

**Regra de elevação:** passo `[R1]` executado contra **Prod** vira R2; qualquer passo não-R0
de runbook **vencido** (item 4) vira R2. Na dúvida entre duas classes, vale a mais alta.
Notas do passo só **elevam** ("em Prod é R2"); nunca baixam a classe da tag — um passo
que vale para UAT e Prod leva a tag do ambiente mais arriscado. O validador impõe a classe
mínima de comandos conhecidos (`gh pr merge`, `vercel env pull` e force-push só em
`[R3] Humano:`; `vercel rollback`/`promote`, `neonctl branches delete|restore|reset`, migração
em `.env.prod` no mínimo `[R2]`) e recusa mais de uma tag por passo.

### 3. Protocolo de aprovação R2

Antes de executar, o agente mostra num bloco único: **operação** (comando exato, sem
segredos), **ambiente**, **efeito esperado**, **rollback** — e pergunta "Aprovo esta
operação?". Só um "sim" explícito do humano **para aquela operação** autoriza. A aprovação
não se estende a outros passos, outros ambientes nem execuções futuras; silêncio ou resposta
ambígua = não. Negada a aprovação, o agente para e registra "interrompido por decisão humana".

### 4. Regras transversais

- **Pre-flight de identidade** antes de qualquer R1+: conta `gh` ativa (regra 5 do
  `CLAUDE.md`), team/scope Vercel, projeto e branch Neon, tenant Auth0 — todos do
  ambiente-alvo, conforme os valores declarados no runbook. Divergência → para.
- **Segredos:** o agente nunca vê nem imprime o valor — isso inclui **bearer tokens** (JWT
  OAuth, PAT `pat_…`) usados para testar o MCP. O humano o digita no dashboard ou
  rodando `vercel env add <NOME> <ambiente>` num terminal separado, **fora da sessão do
  agente** (nunca pelo prefixo `!`, cuja saída cai no contexto); o agente verifica só a
  **presença do nome**. Nunca em
  commit, log, comentário de PR ou argumento de comando visível.
- **Rollback obrigatório:** todo runbook tem a seção; ela é executada em falha de passo ou
  de verificação, com os mesmos gates — salvo quando o próprio passo diz o que fazer na
  falha ("não é caso de rollback", "voltar ao passo N", "não resolveu → passo N"): a
  instrução do passo prevalece.
- **Frescor:** metadado `Última verificação` (data ISO). Mais de **90 dias** → aviso +
  elevação (item 2). Quem executa com sucesso um runbook não vencido pode atualizar a data
  via PR.
- **Placeholders:** `<preencher: …>` (entrada) em qualquer lugar torna o runbook **não
  executável**; o agente para, pede os dados e propõe o PR que completa o runbook.
  `<gerado: …>` (saída de outro runbook) bloqueia igualmente, **exceto** no runbook que o
  produz (`bootstrap-ambientes.md`), que o grava via PR ao final.

### 5. Registro

Toda execução com passo R1+ gera um registro: comentário no PR relacionado
(`gh pr comment`) ou, sem PR, numa issue com label `ops`. Conteúdo: runbook + data de
`Última verificação`, ambiente, passos executados com resultado, aprovações R2 (quem/quando,
texto da operação), passos R3 entregues ao humano, resultado final
(`ok` | `rollback` | `interrompido`). Nunca contém segredos. Publicar o registro é R1
(consequência da operação já autorizada).

### 6. Formato verificável

Runbooks seguem `docs/runbooks/_TEMPLATE.md`: metadados (`Responsável`, `Última
verificação`, `Ambientes`), seções H2 fixas e em ordem (Objetivo, Pré-condições, Pre-flight,
Passos, Verificação final, Rollback, Registro), passos numerados com classe e `Verificar:`.
`npm run check:runbooks` (`scripts/check-runbooks.mjs`) valida formato e catálogo
obrigatório no CI. O template roda sem `--strict` (o catálogo tem `<preencher>` por design);
o projeto adotado roda com `--strict` (sem placeholders, data ISO válida). Frescor **não** é
checado no CI (falharia PRs pela passagem do tempo) — é aplicado pela skill na execução.

### 7. Obrigação de adoção

Ao adotar o template, o projeto **deve**, antes do primeiro deploy fora do Dev:

1. preencher todo `<preencher>` dos runbooks (team Vercel, projeto Neon, tenants Auth0,
   URLs, responsáveis) e datar `Última verificação`;
2. trocar o passo do CI para `npm run check:runbooks -- --strict`;
3. adicionar um runbook (no formato) para cada operação recorrente nova do projeto.

## Consequências

**Positivas**
- Operação previsível e auditável: o mesmo procedimento, com os mesmos gates, seja quem for
  o agente.
- O agente tem autonomia real onde o risco é baixo (Dev/UAT) e o humano decide onde importa
  (Prod, segredos, destrutivo, escrita MCP).
- O CI garante que o catálogo existe e está no formato — e, no projeto adotado, completo.

**Negativas / custos**
- Cerimônia por operação (aprovação R2 a cada passo de Prod).
- Runbooks envelhecem com as ferramentas (CLIs mudam de flag) — mitigado pelo frescor de
  90 dias e pela elevação a R2.
- Aprovação no chat não é assinatura forte; serve como trilha, não como controle
  criptográfico (ChatOps fica como evolução).

## Alternativas Consideradas

- **Agente autônomo até Prod** — descartada: merge = deploy em Prod sem humano, e segredos
  passariam pelo contexto do agente.
- **Humano aprova tudo** — descartada: trava o ciclo PR → UAT, que é justamente onde o
  agente mais ajuda.
- **Runbooks como skills** — descartada: acopla procedimentos operacionais a uma ferramenta
  de agente e mistura operação com desenvolvimento; markdown no repo serve a humanos e a
  qualquer agente. A skill `runbook-execution` é **uma só** e genérica.
- **IaC (Terraform/Pulumi) já** — adiada: é decisão de cada projeto (ADR próprio); um
  runbook pode passar a chamar o `plan`/`apply`.
