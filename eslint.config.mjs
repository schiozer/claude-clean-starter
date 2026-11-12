import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Flat config auto-contido (não depende de nenhum framework de produto).
// Ao adotar um framework (ex.: Next.js), estenda a config oficial dele aqui.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'out/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      '.superpowers/',
      // Cada exemplo é um projeto autocontido, com tooling e CI próprios
      // (job `example`). O tooling da raiz não o varre — evita conflito de
      // configs/versões e artefatos gerados (ex.: .next/). Exceção: os testes E2E do
      // skeleton rodam com o Playwright da raiz e passam pela regra de import abaixo.
      'examples/**/*',
      '!examples/walking-skeleton/',
      '!examples/walking-skeleton/tests/',
      '!examples/walking-skeleton/tests/e2e/',
      '!examples/walking-skeleton/tests/e2e/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
    ],
  },
  {
    rules: {
      // BEST_PRACTICES: sem `any`. Prefira `unknown` + validação (Zod).
      '@typescript-eslint/no-explicit-any': 'error',
      // `console` proibido no app; o sink central é `src/shared/logError.ts`
      // (única linha com `eslint-disable-next-line no-console`). Regra como
      // ERRO — warning não trava CI e regride com o tempo (ver ADR-009).
      'no-console': 'error',
    },
  },
  {
    // `any` é idiomático em mocks de teste; console é a saída pretendida de CLIs.
    files: ['tests/**', 'scripts/**', 'hooks/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    // E2E importa `test`/`expect` do suporte: é ele que manda o bypass da Vercel só para a
    // origem do preview (ADR-016). Tipos e `devices` continuam vindo de `@playwright/test`.
    files: ['tests/e2e/**', 'examples/walking-skeleton/tests/e2e/**'],
    ignores: ['tests/e2e/support/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              importNames: ['test', 'expect'],
              message:
                "Importe `test`/`expect` de tests/e2e/support (ex.: from '../support'), não de @playwright/test.",
            },
          ],
        },
      ],
    },
  },
  {
    // Scripts `.mjs` rodam no Node (sem tipos do TS para resolver os globais).
    files: ['scripts/**/*.mjs', 'hooks/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  }
)
