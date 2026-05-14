import { defineConfig } from 'vitest/config'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [
    crx({
      manifest,
      browser: 'chrome',
    }),
  ],
  server: {
    port: 5174,
    strictPort: true,
    hmr: { port: 5174 },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
