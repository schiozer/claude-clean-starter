// Cenário da ajuda (spec examples/walking-skeleton/docs/specs/ajuda.md §8). Roda nos projetos
// `desktop` e `mobile`, com a sessão do usuário final, sobre as páginas geradas em docs/ajuda/.
import { type Locator, type Page } from '@playwright/test'
import { checarA11y, jornada, expect, test } from '../../../../../tests/e2e/support'

const PUBLICA = 'Criar um recurso e vê-lo na lista'
const INTERNA = 'Ver a lista de recursos como time interno'

/** Aperta Tab até o elemento receber o foco (falha se não chegar). */
const tabAte = async (page: Page, alvo: Locator, tecla = 'Tab'): Promise<void> => {
  for (let i = 0; i < 15 && !(await alvo.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press(tecla)
  }
  await expect(alvo, `${tecla} alcança o elemento`).toBeFocused()
}

const legenda = (page: Page) => page.locator('figcaption')

const vejoPasso = (page: Page, n: number) =>
  expect(legenda(page)).toHaveText(new RegExp(`^Passo ${n} de \\d+: \\S`))

test(
  'CT-AJU-001 navegar pela ajuda só com o teclado',
  { tag: ['@usabilidade', '@regressao'] },
  async ({ page }) => {
    const link = page.getByRole('link', { name: PUBLICA })
    await jornada(
      'CT-AJU-001',
      {
        'que estou logado como usuário final': async () => {
          await page.goto('/')
          await expect(page, 'sessão válida: sem redirecionar ao login').not.toHaveURL(/login/)
        },
        'abro a ajuda': async () => {
          await page.goto('/ajuda')
          await expect(page.getByRole('heading', { level: 1, name: 'Ajuda' })).toBeVisible()
        },
        'vejo a página "Criar um recurso e vê-lo na lista"': () => expect(link).toBeVisible(),
        'não vejo a página "Ver a lista de recursos como time interno"': async () => {
          await expect(page.getByRole('link', { name: INTERNA })).toHaveCount(0)
          await expect(page.getByText('time interno')).toHaveCount(0)
        },
        'chego à página "Criar um recurso e vê-lo na lista" com Tab e aperto Enter': async () => {
          await tabAte(page, link)
          await page.keyboard.press('Enter')
          await expect(page).toHaveURL(/\/ajuda\/CT-RES-001$/)
        },
        'vejo o passo 1 com o screenshot e a legenda': async () => {
          await expect(page.getByRole('heading', { level: 1, name: PUBLICA })).toBeVisible()
          await expect(legenda(page)).toHaveText(
            /^Passo 1 de \d+: Dado que estou logado como usuário final$/
          )
          const imagem = page.getByRole('img', { name: /^Tela do passo 1:/ })
          await expect(imagem).toBeVisible()
          await expect
            .poll(() => imagem.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
              message: 'o screenshot carrega pela rota autenticada',
            })
            .toBeGreaterThan(0)
          await checarA11y(page)
        },
        'aperto Tab até o botão "Próximo" e aperto Enter': async () => {
          await tabAte(page, page.getByRole('button', { name: 'Próximo passo' }))
          await page.keyboard.press('Enter')
        },
        'vejo o passo 2': () => vejoPasso(page, 2),
        'aperto Shift+Tab até o botão "Anterior" e aperto Enter': async () => {
          await tabAte(page, page.getByRole('button', { name: 'Passo anterior' }), 'Shift+Tab')
          await page.keyboard.press('Enter')
        },
        'volto ao passo 1': () => vejoPasso(page, 1),
        'aperto a seta para a direita': () => page.keyboard.press('ArrowRight'),
        'avanço de novo para o passo 2': () => vejoPasso(page, 2),
      },
      { page }
    )
  }
)
