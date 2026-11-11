// Checagem de acessibilidade com axe (spec e2e-regressao-docs §6): falha em `serious`/`critical`
// e anexa as violações `moderate` ao relatório do Playwright.
import AxeBuilder from '@axe-core/playwright'
import { test, type Page } from '@playwright/test'

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const BLOQUEIA = ['serious', 'critical']

export const checarA11y = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  const resumo = (v: (typeof violations)[number]) =>
    `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} elemento(s)) — ${v.helpUrl}`

  const moderadas = violations.filter((v) => v.impact === 'moderate')
  if (moderadas.length > 0) {
    await test.info().attach('axe-moderate', {
      body: JSON.stringify(moderadas, null, 2),
      contentType: 'application/json',
    })
  }

  const graves = violations.filter((v) => v.impact && BLOQUEIA.includes(v.impact))
  if (graves.length > 0) {
    throw new Error(
      `acessibilidade: ${graves.length} violação(ões) serious/critical em ${page.url()}:\n${graves.map(resumo).join('\n')}`
    )
  }
}
