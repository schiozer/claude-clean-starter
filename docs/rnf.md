# Requisitos não funcionais — baseline do projeto

Baseline de RNF e usabilidade que vale para **todo** o sistema e roda **sempre** na regressão
(spec [e2e-regressao-docs §5 e §6](./superpowers/specs/2026-11-09-e2e-regressao-docs-design.md)).
Este arquivo é do projeto (não é gerenciado pelo template-sync): ajuste os valores aqui. Os testes
de `tests/e2e/baseline/` leem as tabelas abaixo — nenhum número é redigitado no código.

- **Valor**: número + unidade (`ms`, `s`, `min`, `h`, `d`, `px`) ou `—` quando o requisito não tem
  número. Um desvio de uma feature vai na spec dela (seção "Requisitos não funcionais"), com ID
  próprio.
- **Telas**: as páginas do app cobertas pelos cenários de usabilidade. Página nova precisa entrar
  em "Telas" ou em "Exclusões" (o check `Cenários × testes` acusa).

## Requisitos

| ID          | Categoria   | Requisito                                                                                                                                                                        | Valor     |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| RNF-SEG-001 | Hardening   | Headers em toda resposta HTML: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors`/`X-Frame-Options` | —         |
| RNF-SEG-002 | Hardening   | Cookie de sessão `Secure`, `HttpOnly`, `SameSite=Lax` ou mais restrito                                                                                                           | —         |
| RNF-SEG-003 | Hardening   | Toda rota `/api/*` (exceto as públicas declaradas) responde 401 sem identidade e 403 sem escopo — fail-closed                                                                    | —         |
| RNF-SEG-004 | Hardening   | Erro técnico não vaza stack trace, SQL nem mensagem interna (corpo `{ error, code }` genérico — ADR-009)                                                                         | —         |
| RNF-SEG-005 | Hardening   | Rate limit responde 429 no REST ou `RATE_LIMITED` no MCP (ADR-010) ao exceder o limite do ator                                                                                   | —         |
| RNF-SEG-006 | Hardening   | `/api/mcp` sem token → 401 com `WWW-Authenticate` + `resource_metadata` (ADR-012)                                                                                                | —         |
| RNF-TMO-001 | Timeout     | Rota de API não passa de **10 s**; ao estourar, devolve erro técnico tratado (não pendura)                                                                                       | 10 000 ms |
| RNF-TMO-002 | Timeout     | A UI desiste da chamada após **15 s** e mostra o estado "tente novamente" (erro técnico)                                                                                         | 15 000 ms |
| RNF-SES-001 | Sessão      | Sessão expira por inatividade em **8 h** e tem vida máxima de **7 dias** (o projeto ajusta)                                                                                      | 8 h       |
| RNF-SES-002 | Sessão      | Sessão expirada/inválida em rota de tela → redireciona ao login e volta à página de origem após logar                                                                            | —         |
| RNF-SES-003 | Sessão      | Logout invalida a sessão no servidor (cookie antigo reaproveitado → 401)                                                                                                         | —         |
| RNF-PRF-001 | Performance | Chamada de API do caminho feliz responde em **< 1 s** no UAT (orçamento por requisição, não p95 de carga)                                                                        | 1 000 ms  |
| RNF-PRF-002 | Performance | LCP **< 2,5 s** nas páginas principais no perfil mobile                                                                                                                          | 2 500 ms  |
| USA-001     | Usabilidade | Acessibilidade automática: axe com regras WCAG 2.2 AA, zero violações `serious`/`critical` (as `moderate` viram aviso no relatório)                                              | —         |
| USA-002     | Usabilidade | Responsivo: desktop (1280×800) e mobile (iPhone de referência) sem rolagem horizontal; no mobile, alvo de toque ≥ 44 px                                                          | 44 px     |
| USA-003     | Usabilidade | Teclado: o caminho feliz é completável só com teclado (Tab/Enter/Espaço/Esc), com foco visível em todo elemento focável                                                          | —         |
| USA-004     | Usabilidade | Estados: ação assíncrona mostra loading (`aria-busy`); erro funcional com tom de aviso (`role="status"`) e erro técnico com tom de alerta (`role="alert"`) e "tente novamente"   | —         |
| USA-005     | Usabilidade | Nome acessível: todo botão só-ícone tem `aria-label` (BEST_PRACTICES)                                                                                                            | —         |

> RNF-SES-001: o teste confere a inatividade (`Max-Age`/`expires` do cookie de sessão ≤ 8 h + 60 s).
> A vida máxima de 7 dias é aplicada pelo servidor (no skeleton, `E2E_SESSION_MAX_MS`) e coberta
> pelos testes de unidade do provider de sessão.

## Parâmetros dos testes

Como os testes genéricos do baseline encontram a sessão e as rotas deste app. Ajuste ao seu login.

| Chave               | Valor                                        |
| ------------------- | -------------------------------------------- |
| cookieDeSessao      | `e2e_session`                                |
| rotaDeLogin         | `/dev-login`                                 |
| rotaDeLogout        | `/api/logout`                                |
| rotaProtegida       | `/api/resources`                             |
| telaComApi          | `/resources`                                 |
| rotasPublicas       | `/`, `/.well-known/oauth-protected-resource` |
| limiteDeTaxaMcp     | `60`                                         |
| margemDePerformance | `0`                                          |

- `rotasPublicas`: rotas que respondem sem identidade (nunca 401). `/` aqui é pública no sentido de
  não devolver 401: sem sessão, a tela redireciona ao login.
- `telaComApi`: tela que chama a `rotaProtegida` ao abrir (RNF-TMO-002).
- `limiteDeTaxaMcp`: chamadas por ator por minuto antes do `RATE_LIMITED` — o mesmo número do rate
  limiter do app (`src/composition.ts`, ADR-010). Mudou lá, mude aqui. O teste exige a fronteira
  exata (as `limite` primeiras passam, a seguinte é recusada). O limiter do skeleton é **em memória,
  por instância**: com várias instâncias (UAT/Prod na Vercel) o limite efetivo vira N × limite e o
  teste fica instável — lá é preciso um limiter compartilhado (tabela Postgres, ADR-010).
- `margemDePerformance`: tolerância, em %, sobre os orçamentos de RNF-PRF-001/002 antes de falhar
  (spec §5.3: evita instabilidade). `0` = o orçamento exato.

## Telas

| Rota       | Nome     |
| ---------- | -------- |
| /          | Início   |
| /resources | Recursos |
| /ajuda     | Ajuda    |

## Exclusões

- `/dev-login`
- `/ajuda/[id]`

`/ajuda/[id]` é rota dinâmica (um ID por página de ajuda gerada): o baseline não sabe qual abrir; o
cenário CT-AJU-001 (`examples/walking-skeleton/docs/specs/ajuda.md`) a cobre pelo teclado e pelo axe.
