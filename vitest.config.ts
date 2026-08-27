import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // E2E (Playwright) roda em runner próprio (npm run test:e2e).
    // examples/** são projetos autocontidos com seu próprio job de CI.
    exclude: ['**/node_modules/**', '**/tests/e2e/**', 'examples/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
