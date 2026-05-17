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
      //
      // BE-8-6 offscreen document — production parent of the sandbox iframe.
      // Not declared in manifest; instantiated at runtime via
      // chrome.offscreen.createDocument({url: 'src/offscreen/offscreen.html'}).
      // Must be a rollup input so CRXJS includes it in dist/.
      input: {
        'spike-page': 'src/translator-runtime/spike-page.html',
        offscreen: 'src/offscreen/offscreen.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
