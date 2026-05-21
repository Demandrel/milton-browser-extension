import { defineConfig } from 'vitest/config'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig(({ mode }) => ({
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
      // BE-8-6 offscreen document — production parent of the sandbox iframe.
      // Not declared in manifest; instantiated at runtime via
      // chrome.offscreen.createDocument({url: 'src/offscreen/offscreen.html'}).
      // Must be a rollup input so CRXJS includes it in dist/.
      //
      // BE-8-4 spike-page — extension-origin wrapper page that hosts the
      // sandbox iframe + pre-fetches the URL. DEV-mode ONLY; excluded from
      // production builds per BE-8-10 AC1 (Method-17 finding 2026-05-19 —
      // spike-page.html + spike-page.ts were previously shipping in
      // production builds, leaking `window.miltonRuntimeSpike` into the CWS
      // artifact). Default Vite mode for `vite build` is "production", so
      // `pnpm build` excludes spike-page; `pnpm dev` (mode="development")
      // includes it for the BE-8-4 spike workflow.
      input: {
        offscreen: 'src/offscreen/offscreen.html',
        ...(mode === 'production'
          ? {}
          : { 'spike-page': 'src/translator-runtime/spike-page.html' }),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
