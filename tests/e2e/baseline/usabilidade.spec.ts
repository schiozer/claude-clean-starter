// Baseline de usabilidade (docs/rnf.md, USA-*; spec e2e-regressao-docs §6), aplicado a toda tela de
// `telas()`. Roda nos projetos `desktop` e `mobile` com a sessão do usuário; o alvo de toque só vale
// no mobile.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { checarA11y, rnf, telas } from '../support'

const TAG = ['@usabilidade', '@regressao']

const abrir = async (page: Page, rota: string): Promise<void> => {
  await page.goto(rota)
  expect(new URL(page.url()).pathname, `${rota}: abriu a tela (sessão válida)`).toBe(rota)
}

/** Alertas com conteúdo: o anunciador de rota do framework é um `role="alert"` vazio. */
const alertas = (page: Page) => page.getByRole('alert').filter({ hasText: /\S/ })

const ehChamadaDeApi = (route: Route): boolean =>
  ['fetch', 'xhr'].includes(route.request().resourceType()) &&
  new URL(route.request().url()).pathname.startsWith('/api/')

test('USA-001 acessibilidade automática sem violações graves', { tag: TAG }, async ({ page }) => {
  for (const { rota, nome } of telas()) {
    await test.step(`${nome} (${rota})`, async () => {
      await abrir(page, rota)
      await checarA11y(page)
    })
  }
})

test(
  'USA-002 responsivo sem rolagem horizontal e alvo de toque',
  { tag: TAG },
  async ({ page, isMobile }) => {
    const alvo = rnf('USA-002').valor
    if (!alvo || alvo.unidade !== 'px')
      throw new Error('USA-002: valor do alvo de toque deve ser em px')
    for (const { rota, nome } of telas()) {
      await test.step(`${nome} (${rota})`, async () => {
        await abrir(page, rota)
        const largura = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }))
        expect(largura.scroll, 'sem rolagem horizontal').toBeLessThanOrEqual(largura.client)
        if (!isMobile) return

        const pequenos = await page.evaluate((min) => {
          const visivel = (el: Element, r: DOMRect) => {
            const cs = getComputedStyle(el)
            return (
              r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
            )
          }
          // Link no meio de um texto corrido é exceção do WCAG 2.5.8 (alvo inline).
          const inlineEmTexto = (el: Element) =>
            getComputedStyle(el).display === 'inline' &&
            (el.parentElement?.textContent ?? '').trim() !== (el.textContent ?? '').trim()
          return [...document.querySelectorAll('button, a, input')]
            .filter((el) => !(el instanceof HTMLInputElement && el.type === 'hidden'))
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ el, r }) => visivel(el, r) && !inlineEmTexto(el))
            .filter(({ r }) => r.width < min || r.height < min)
            .map(({ el, r }) => {
              const nomeEl = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.id
              return `${el.tagName.toLowerCase()} "${nomeEl}" ${Math.round(r.width)}×${Math.round(r.height)}`
            })
        }, alvo.numero)
        expect(pequenos, `alvos de toque < ${alvo.numero}×${alvo.numero} px`).toEqual([])
      })
    }
  }
)

test('USA-003 teclado percorre os focáveis com foco visível', { tag: TAG }, async ({ page }) => {
  for (const { rota, nome } of telas()) {
    await test.step(`${nome} (${rota})`, async () => {
      await abrir(page, rota)
      await page.waitForLoadState('networkidle')
      const total = await page.evaluate(
        () =>
          [
            ...document.querySelectorAll(
              'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ),
          ].filter((el) => el.getClientRects().length > 0).length
      )
      const visitados = new Set<string>()
      for (let i = 0; i < total; i++) {
        await page.keyboard.press('Tab')
        const foco = await page.evaluate(() => {
          const el = document.activeElement
          if (!el || el === document.body) return null
          const cs = getComputedStyle(el)
          const contorno = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
          return {
            id: `${el.tagName.toLowerCase()}#${el.id}:${el.textContent?.trim() ?? ''}`,
            visivel: contorno || cs.boxShadow !== 'none',
          }
        })
        expect(foco, `Tab ${i + 1}: algum elemento recebe o foco`).not.toBeNull()
        if (!foco) return
        expect(foco.visivel, `${foco.id}: foco visível (outline ou box-shadow)`).toBe(true)
        visitados.add(foco.id)
      }
      expect(visitados.size, 'Tab alcança todos os focáveis').toBe(total)
    })
  }
})

test(
  'USA-004 estados de loading, erro funcional e erro técnico',
  { tag: TAG },
  async ({ page }) => {
    for (const { rota, nome } of telas()) {
      await test.step(`${nome} (${rota})`, async () => {
        const chamadas: string[] = []
        page.on('request', (req) => {
          const path = new URL(req.url()).pathname
          if (['fetch', 'xhr'].includes(req.resourceType()) && path.startsWith('/api/')) {
            chamadas.push(path)
          }
        })
        await abrir(page, rota)
        await page.waitForLoadState('networkidle')
        page.removeAllListeners('request')
        if (chamadas.length === 0) {
          test.info().annotations.push({
            type: 'USA-004',
            description: `${rota}: sem chamada de API ao abrir`,
          })
          return
        }

        // Loading → erro técnico: a chamada fica pendente e depois falha com 500.
        const pendentes: Route[] = []
        await page.route('**/api/**', (route) =>
          ehChamadaDeApi(route) ? void pendentes.push(route) : route.continue()
        )
        await abrir(page, rota)
        await expect.poll(() => pendentes.length, 'a tela chama a API').toBeGreaterThan(0)
        await expect(page.locator('[aria-busy="true"]').first(), 'loading visível').toBeVisible()
        for (const route of pendentes.splice(0)) {
          await route.fulfill({
            status: 500,
            json: { error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' },
          })
        }
        await expect(alertas(page), 'erro técnico em alerta').toContainText(/tente novamente/i)
        await expect(page.locator('[aria-busy="true"]'), 'loading encerrado').toHaveCount(0)
        await page.unrouteAll({ behavior: 'wait' })

        // Erro funcional: mensagem acionável no tom de aviso, sem alerta.
        const mensagem = 'Acesso negado a este recurso (teste de estado)'
        await page.route('**/api/**', (route) =>
          ehChamadaDeApi(route)
            ? route.fulfill({ status: 403, json: { error: mensagem, code: 'FORBIDDEN' } })
            : route.continue()
        )
        await abrir(page, rota)
        await expect(page.getByRole('status'), 'erro funcional em aviso').toContainText(mensagem)
        await expect(alertas(page), 'erro funcional não é alerta').toHaveCount(0)
        await page.unrouteAll({ behavior: 'wait' })
      })
    }
  }
)

test('USA-005 botões só-ícone têm nome acessível', { tag: TAG }, async ({ page }) => {
  for (const { rota, nome } of telas()) {
    await test.step(`${nome} (${rota})`, async () => {
      await abrir(page, rota)
      await page.waitForLoadState('networkidle')
      const semNome = await page.evaluate(() =>
        [...document.querySelectorAll('button, [role="button"]')]
          .filter((el) => (el as HTMLElement).innerText.trim() === '')
          .filter(
            (el) =>
              !el.getAttribute('aria-label')?.trim() &&
              !el.getAttribute('aria-labelledby')?.trim() &&
              !el.getAttribute('title')?.trim()
          )
          .map((el) => el.outerHTML.slice(0, 120))
      )
      expect(semNome, 'botão só-ícone sem aria-label').toEqual([])
      const { violations } = await new AxeBuilder({ page }).withRules(['button-name']).analyze()
      expect(
        violations.map((v) => v.id),
        'axe button-name'
      ).toEqual([])
    })
  }
})
