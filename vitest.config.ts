import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Resolve the engine package to its TypeScript source so tests run against
// engine source with no build step (mirrors backend/tsconfig.json `paths`).
const engineSrc = fileURLToPath(new URL('./packages/engine/src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^mcpscope-engine\/(.*)\.js$/, replacement: `${engineSrc}/$1.ts` },
      { find: /^mcpscope-engine$/, replacement: `${engineSrc}/index.ts` },
    ],
  },
  test: {
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
    // The benchmark-run and token-sanity suites are timing-sensitive: their
    // scripted models are fast, but under heavy CPU load (parallel agents, CI
    // runners) the default 5s budget produces all-timeout false failures.
    testTimeout: 20000,
  },
})
