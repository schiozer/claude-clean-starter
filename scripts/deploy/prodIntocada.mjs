// Contrato do `promoverProd` dos adaptadores com o promover da esteira: um erro marcado com
// `prodAlterada: false` diz que a falha veio antes de qualquer mudança em Prod (conferências do
// pacote, leitura de estado), e então o promover não faz rollback — reverter uma Prod saudável é
// pior que o erro. Erro sem a marca = Prod pode ter mudado (o promover faz rollback).

/**
 * Roda `fn` (a fase do `promoverProd` que ainda não mexeu em Prod) e marca o erro, se houver.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function antesDeMudarProd(fn) {
  try {
    return await fn()
  } catch (error) {
    const erro = error instanceof Error ? error : new Error(String(error))
    throw Object.assign(erro, { prodAlterada: false })
  }
}

/** O erro diz que Prod não foi alterada? */
export const prodIntocada = (error) =>
  typeof error === 'object' && error !== null && error.prodAlterada === false
