import { defineManifest } from '@crxjs/vite-plugin'
import packageJson from './package.json' with { type: 'json' }

const { version, description } = packageJson

export default defineManifest({
  manifest_version: 3,
  name: 'Milton',
  description,
  version,
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Save to Milton',
    default_icon: {
      '16': 'src/assets/icons/16.png',
      '32': 'src/assets/icons/32.png',
      '48': 'src/assets/icons/48.png',
      '128': 'src/assets/icons/128.png',
    },
  },
  icons: {
    '16': 'src/assets/icons/16.png',
    '32': 'src/assets/icons/32.png',
    '48': 'src/assets/icons/48.png',
    '128': 'src/assets/icons/128.png',
  },
  permissions: [
    'activeTab',
    // BE-8-9 — chrome.alarms for the periodic 6h translator refresh tick.
    // Requires the service worker declared in `background` below.
    'alarms',
    // BE-8-5 — translator-fetcher.ts caches the manifest + lazy-fetched
    // translators in chrome.storage.local (translator-mirror-metadata +
    // translator-fetched:* keys; LRU-capped at 50 entries; well under the
    // default 10 MB quota). Without this permission `chrome.storage.local`
    // is undefined and the lazy-fetch path throws STORAGE_UNAVAILABLE.
    'storage',
    // BE-8-6 — popup uses chrome.scripting.executeScript against the active
    // tab to scrape its rendered DOM (Class 3 capture flow). Combined with
    // `activeTab` (already declared) this grants per-invocation scripting
    // rights on the user-clicked tab without broad host_permissions.
    'scripting',
    // BE-8-6 — popup uses chrome.offscreen API to host the translator
    // sandbox iframe outside the popup's window (so translations survive
    // popup close). One offscreen document per extension; created lazily
    // via offscreen-client.ts:ensureOffscreenDocument.
    'offscreen',
  ],
  // BE-8-9 — service worker hosts the periodic translator-refresh alarm.
  // CRXJS rewrites the path + emits service-worker-loader.js at build time.
  background: {
    service_worker: 'src/sw/sw.ts',
    type: 'module',
  },
  host_permissions: [
    'https://translate.milton.so/*',
    // BE-8-5 — extension fetches the manifest + per-translator code from the
    // translator-mirror CDN (Ed25519 + SHA-256 verified). Required for both
    // (a) the lazy long-tail fetch path (translator-fetcher.ts; popup/SW),
    // and (b) the SPIKE-ONLY spike-page.ts handler that delegates the
    // sandbox's lazy-load to this fetch.
    'https://translators.milton.so/*',
    // BE-8-4 spike target — extension fetches arXiv abs HTML for translator execution.
    'https://arxiv.org/*',
    'https://export.arxiv.org/*',
  ],
  // BE-8-4 — sandbox page hosts the zotero/translate runtime. MV3 sandbox CSP
  // (`script-src 'self' 'unsafe-eval'`) permits eval()/new Function() needed
  // to execute downloaded translator JS without relaxing CSP on extension pages.
  sandbox: {
    pages: ['src/translator-runtime/sandbox.html'],
  },
})
