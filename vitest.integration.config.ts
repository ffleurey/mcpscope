import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Resolve the engine package to its TypeScript source (mirrors vitest.config.ts
// and backend/tsconfig.check.json) so integration tests need no engine build.
const engineSrc = fileURLToPath(new URL('./packages/engine/src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^mcpscope-engine\/(.*)\.js$/, replacement: `${engineSrc}/$1.ts` },
      { find: /^mcpscope-engine$/, replacement: `${engineSrc}/index.ts` },
    ],
  },
  test: {
    include: ['backend/src/**/*.integration.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
})
