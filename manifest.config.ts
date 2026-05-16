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
  permissions: ['activeTab'],
  host_permissions: [
    'https://translate.milton.so/*',
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
