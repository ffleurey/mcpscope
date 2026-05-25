import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@mcpscope/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
  },
})
