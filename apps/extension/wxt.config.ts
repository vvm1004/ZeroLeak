import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({
    plugins: [react()],
  }),
  manifest: {
    name: 'ZeroLeak',
    description: 'On-Device AI DLP & Threat Security (GDG DevFest 2026)',
    version: '1.0.0',
    permissions: [
      'storage',
      'activeTab',
      'contextMenus',
      'scripting',
      'notifications',
      'tabs',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'ZeroLeak Shield',
    },
  },
});
