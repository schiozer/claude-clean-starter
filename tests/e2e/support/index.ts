// API pública dos helpers de E2E (gerenciada pelo template). Testes importam só daqui.
import { join } from 'node:path'
import { makeGanchoDeDocs } from './docs'
import { makeGanchoDeLegenda } from './demos'
import { RAIZ, indiceAtual } from './indice'
import { registrarGanchoDePasso } from './jornada'
import { test } from './test'

export { expect, test } from './test'
export { jornada, registrarGanchoDePasso } from './jornada'
export type { GanchoDePasso, PassoCtx, Passos } from './jornada'
export { dado } from './dado'
export { parametro, rnf, rnfMs, telas, telasExigidas } from './rnf'
export type { Requisito } from './rnf'
export { AXE_TAGS, checarA11y } from './axe'
export { credencialAuth0, entrar, loginAuth0, loginDev, perfis } from './auth'
export type { Perfil } from './auth'
export { cabecalhosDeBypass, e2eEnv } from './env'
export type { E2eEnv, Env } from './env'

// `npm run docs:gerar` (`E2E_DOCS=1`): screenshot por passo dos cenários `@doc` no projeto desktop
// e página de ajuda em `ajuda` do `cenarios.config.json`. Uma vez por worker (módulo em cache).
if (process.env.E2E_DOCS === '1') {
  const { ajuda } = indiceAtual().config
  if (!ajuda) throw new Error('docs:gerar: defina "ajuda" em tests/e2e/cenarios.config.json')
  registrarGanchoDePasso(
    makeGanchoDeDocs({ dir: join(RAIZ, ajuda), projeto: () => test.info().project.name })
  )
}

// `npm run demos:gravar` (`E2E_DEMOS=1`): legenda do passo e destaque do clique nos vídeos
// `@demo`/`@treinamento`. Roda antes do passo, para a legenda já estar na tela durante a ação.
if (process.env.E2E_DEMOS === '1') {
  registrarGanchoDePasso(makeGanchoDeLegenda(), { momento: 'antes' })
}
