// Cenário CT-AJU-002 (spec examples/walking-skeleton/docs/specs/ajuda.md §8). O `webServer` local
// liga `DEMOS_BUNNY` e aponta o catálogo para uma porta fechada: o app deve degradar com aviso.
import { jornada, expect, test } from '../../../../../tests/e2e/support'

const PUBLICA = 'Criar um recurso e vê-lo na lista'

test.skip(!!process.env.E2E_BASE_URL, 'depende do catálogo inacessível do webServer local')

test(
  'CT-AJU-002 ver a ajuda quando os vídeos estão indisponíveis',
  { tag: ['@e2e', '@regressao'] },
  async ({ page }) => {
    await jornada(
      'CT-AJU-002',
      {
        'que estou logado como usuário final': async () => {
          await page.goto('/')
          await expect(page, 'sessão válida: sem redirecionar ao login').not.toHaveURL(/login/)
        },
        'abro a página "Criar um recurso e vê-lo na lista" da ajuda': async () => {
          await page.goto('/ajuda/CT-RES-001')
          await expect(page.getByRole('heading', { level: 1, name: PUBLICA })).toBeVisible()
        },
        'vejo o passo 1 com o screenshot e a legenda': async () => {
          await expect(page.locator('figcaption')).toHaveText(/^Passo 1 de \d+: \S/)
          await expect(page.getByRole('img', { name: /^Tela do passo 1:/ })).toBeVisible()
        },
        'vejo o aviso "Vídeos indisponíveis no momento."': () =>
          expect(page.getByRole('status')).toHaveText('Vídeos indisponíveis no momento.'),
      },
      { page }
    )
  }
)
