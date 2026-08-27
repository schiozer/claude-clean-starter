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
      // configs/versões e artefatos gerados (ex.: .next/).
      'examples/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
    ],
  },
  {
    rules: {
      // BEST_PRACTICES: sem `any`. Prefira `unknown` + validação (Zod).
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'warn',
    },
  }
)
