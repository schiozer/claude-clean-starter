// Cenários de criação de recurso (spec examples/walking-skeleton/docs/specs/resources.md §8).
// Rodam nos projetos `desktop` e `mobile`, com a sessão do usuário final (`perfis.usuario`).
import { type Page } from '@playwright/test'
import { jornada, expect, test } from '../../../../../tests/e2e/support'
import { abrirRecursos, tituloUnico } from './apoio'

/** Alertas com conteúdo: o anunciador de rota do Next é um `role="alert"` vazio. */
const alertas = (page: Page) => page.getByRole('alert').filter({ hasText: /\S/ })

test(
  'CT-RES-001 criar um recurso e vê-lo na lista',
  { tag: ['@e2e', '@regressao', '@doc', '@demo'] },
  async ({ page }) => {
    const titulo = tituloUnico('Plano de estudos')
    const campo = page.getByLabel('Título')
    await jornada(
      'CT-RES-001',
      {
        'que estou logado como usuário final': async () => {
          await page.goto('/')
          await expect(page, 'sessão válida: sem redirecionar ao login').not.toHaveURL(/login/)
        },
        'abro a lista de recursos': () => abrirRecursos(page),
        'preencho o título "Plano de estudos"': () => campo.fill(titulo),
        'clico em "Criar"': () => page.getByRole('button', { name: 'Criar' }).click(),
        'vejo o recurso "Plano de estudos" na lista': () =>
          expect(page.getByRole('listitem').filter({ hasText: titulo })).toHaveCount(1),
        'o campo "Título" fica vazio': () => expect(campo).toHaveValue(''),
      },
      { page }
    )
  }
)

test(
  'CT-RES-002 título curto é recusado com aviso',
  { tag: ['@e2e', '@regressao'] },
  async ({ page }) => {
    const campo = page.getByLabel('Título')
    const criar = page.getByRole('button', { name: 'Criar' })
    let mensagemDaApi = ''
    await jornada(
      'CT-RES-002',
      {
        'que estou logado como usuário final': async () => {
          await page.goto('/')
          await expect(page, 'sessão válida: sem redirecionar ao login').not.toHaveURL(/login/)
        },
        'abro a lista de recursos': () => abrirRecursos(page),
        'preencho o título "ab"': () => campo.fill('ab'),
        'o botão "Criar" fica desabilitado': () => expect(criar).toBeDisabled(),
        'o título "ab" chega à API por fora da tela': async () => {
          // A tela não deixa enviar: reescreve o corpo do POST de um título válido para "ab". A
          // resposta é a real do servidor (só o payload da requisição muda).
          await page.route('**/api/resources', (route) =>
            route.request().method() === 'POST'
              ? route.continue({ postData: JSON.stringify({ title: 'ab' }) })
              : route.continue()
          )
          try {
            await campo.fill(tituloUnico('Título válido'))
            const resposta = page.waitForResponse(
              (r) => r.url().endsWith('/api/resources') && r.request().method() === 'POST'
            )
            await criar.click()
            const res = await resposta
            expect(res.status(), 'a API recusa o título curto').toBe(400)
            const corpo = (await res.json()) as { error?: string; code?: string }
            expect(corpo.code).toBe('VALIDATION_ERROR')
            expect(corpo.error, 'mensagem acionável da API').toBeTruthy()
            mensagemDaApi = corpo.error ?? ''
          } finally {
            await page.unrouteAll({ behavior: 'wait' })
          }
        },
        'vejo o aviso com a mensagem da API': () =>
          expect(page.getByRole('status')).toHaveText(mensagemDaApi),
        'não vejo alerta de erro técnico': () => expect(alertas(page)).toHaveCount(0),
      },
      { page }
    )
  }
)

test(
  'CT-RES-003 criar um recurso só com o teclado',
  { tag: ['@usabilidade', '@regressao'] },
  async ({ page }) => {
    const titulo = tituloUnico('Plano de estudos')
    const campo = page.getByLabel('Título')
    await jornada(
      'CT-RES-003',
      {
        'que estou logado como usuário final': async () => {
          await page.goto('/')
          await expect(page, 'sessão válida: sem redirecionar ao login').not.toHaveURL(/login/)
        },
        'abro a lista de recursos': () => abrirRecursos(page),
        'chego ao campo "Título" com Tab': async () => {
          for (
            let i = 0;
            i < 10 && !(await campo.evaluate((el) => el === document.activeElement));
            i++
          ) {
            await page.keyboard.press('Tab')
          }
          await expect(campo, 'o Tab alcança o campo').toBeFocused()
        },
        'digito "Plano de estudos"': () => page.keyboard.type(titulo),
        'aperto Tab até o botão "Criar"': async () => {
          await page.keyboard.press('Tab')
          await expect(page.getByRole('button', { name: 'Criar' })).toBeFocused()
        },
        'aperto Enter': () => page.keyboard.press('Enter'),
        'vejo o recurso "Plano de estudos" na lista': () =>
          expect(page.getByRole('listitem').filter({ hasText: titulo })).toHaveCount(1),
      },
      { page }
    )
  }
)
