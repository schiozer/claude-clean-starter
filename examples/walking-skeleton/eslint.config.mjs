import { FlatCompat } from '@eslint/eslintrc'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import moduleBoundary from './eslint-rules/module-boundary.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` proibido no app (defesa contra dados sem forma; prefira `unknown` + Zod).
      '@typescript-eslint/no-explicit-any': 'error',
      // `console` proibido no app; o único sink autorizado é src/shared/logError.ts
      // (com `eslint-disable-next-line` inline na linha do console).
      'no-console': 'error',
    },
  },
  {
    // Fronteira de módulo (ADR-011), para alias e imports relativos — ver eslint-rules/.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { local: { rules: { 'module-boundary': moduleBoundary } } },
    rules: {
      'local/module-boundary': ['error', { srcDir: join(__dirname, 'src') }],
    },
  },
  {
    // `any` é idiomático em mocks; console é a saída pretendida de scripts/CLIs.
    files: ['tests/**', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
]

export default eslintConfig
