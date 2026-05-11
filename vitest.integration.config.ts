import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['backend/src/**/*.integration.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
})
