import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
    // The benchmark-run and token-sanity suites are timing-sensitive: their
    // scripted models are fast, but under heavy CPU load (parallel agents, CI
    // runners) the default 5s budget produces all-timeout false failures.
    testTimeout: 20000,
  },
})
