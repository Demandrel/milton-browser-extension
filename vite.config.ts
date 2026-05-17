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
  build: {
    rollupOptions: {
      // BE-8-4 spike harness — extension-origin wrapper page that hosts
      // the sandbox iframe and pre-fetches the URL (extension origin,
      // host_permissions apply, no CORS). Not declared in manifest; users
      // navigate directly via chrome-extension://<id>/src/translator-runtime/spike-page.html
      input: {
        'spike-page': 'src/translator-runtime/spike-page.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
