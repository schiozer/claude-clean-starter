import { bumpType } from '../release.mjs'

/** Login do bot da App que faz o fast-forward da produção. */
export const PUSHER_APP = 'esteira-promover[bot]'

/**
 * Classifica um PR pela base/head (spec §5.4).
 * @param {{ base: string, head: string }} pr
 * @param {import('./config.mjs').Esteira} esteira
 * @returns {'feature' | 'hotfix' | 'back-promotion' | 'invalido'}
 */
export function classificarPr({ base, head }, esteira) {
  const ehHotfix = head.startsWith(esteira.prefixoHotfix)
  if (base === esteira.integracao) {
    if (head === esteira.producao) return 'back-promotion'
    return ehHotfix ? 'invalido' : 'feature'
  }
  if (base === esteira.producao && ehHotfix) return 'hotfix'
  return 'invalido'
}

const ORDEM = { patch: 0, minor: 1, major: 2 }

/** Maior bump entre os PRs (títulos e corpos pareados por índice). */
export function maiorBump(titulos, corpos) {
  let maior = 'patch'
  titulos.forEach((titulo, i) => {
    const bump = bumpType(titulo, corpos[i] ?? '')
    if (ORDEM[bump] > ORDEM[maior]) maior = bump
  })
  return maior
}
