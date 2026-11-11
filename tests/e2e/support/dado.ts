// `dado()`: aplica o prefixo único da execução (`E2E_RUN_PREFIX`) só ao dado gravado, nunca ao
// texto do passo (spec e2e-regressao-docs §7.2) — execuções paralelas no mesmo UAT não colidem.
import { e2eEnv } from './env'

export const dado = (texto: string): string => {
  const prefixo = e2eEnv().runPrefix
  return prefixo === '' ? texto : `${texto} · ${prefixo}`
}
