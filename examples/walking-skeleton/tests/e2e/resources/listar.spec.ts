// Cenário de listagem como time interno (spec examples/walking-skeleton/docs/specs/resources.md §8).
// Roda nos projetos `desktop` e `mobile`, com a sessão do perfil interno (`perfis.interno`).
import { e2eEnv, jornada, perfis, expect, test } from '../../../../../tests/e2e/support'
import { abrirRecursos } from './apoio'

test.use({ storageState: perfis.interno })

test(
  'CT-RES-006 ver a lista de recursos como time interno',
  { tag: ['@e2e', '@regressao', '@doc'] },
  async ({ page }) => {
    await jornada(
      'CT-RES-006',
      {
        'que estou logado como time interno': async () => {
          await page.goto('/')
          await expect(page, 'sessão válida: sem redirecionar ao login').not.toHaveURL(/login/)
          if (e2eEnv().auth !== 'dev') return
          // Modo local: o cookie assinado carrega o perfil (`sessionId.perfil.emitido.visto.assinatura`).
          const { cookies } = await page.context().storageState()
          const sessao = cookies.find((c) => c.name === 'e2e_session')
          expect(sessao?.value.split('.')[1], 'sessão do perfil interno').toBe('interno')
        },
        'abro a lista de recursos': () => abrirRecursos(page),
        'vejo a tela "Resources"': () =>
          expect(page.getByRole('heading', { level: 1, name: 'Resources' })).toBeVisible(),
        'vejo a lista de recursos sem erro': async () => {
          await expect(page.getByRole('list')).toBeAttached()
          await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0)
          await expect(page.getByRole('status')).toHaveCount(0)
        },
      },
      { page }
    )
  }
)
