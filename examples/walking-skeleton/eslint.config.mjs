import { FlatCompat } from '@eslint/eslintrc'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    // Fronteira de módulo (ADR-011): fora do módulo importa-se só `@/modules/<ctx>`
    // ou o subpath `@/modules/<ctx>/schemas` (seguro para 'use client').
    // composition.ts é a única exceção (instancia infrastructure/).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/composition.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/*', '!@/modules/*/schemas'],
              message:
                'Importe só pelo index do módulo (@/modules/<ctx>) ou por @/modules/<ctx>/schemas. Ver ADR-011.',
            },
          ],
        },
      ],
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
