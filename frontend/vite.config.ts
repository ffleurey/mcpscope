import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const frontendRoot = fileURLToPath(new URL('./', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  root: frontendRoot,
  cacheDir: '../node_modules/.vite/frontend',
  plugins: [svelte()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3066',
        changeOrigin: true,
      },
    },
  },
})
