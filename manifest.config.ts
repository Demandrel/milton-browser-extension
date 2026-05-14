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
      '48': 'src/assets/icons/48.png',
      '128': 'src/assets/icons/128.png',
    },
  },
  icons: {
    '16': 'src/assets/icons/16.png',
    '48': 'src/assets/icons/48.png',
    '128': 'src/assets/icons/128.png',
  },
  permissions: ['activeTab'],
  host_permissions: ['https://translate.milton.so/*'],
})
