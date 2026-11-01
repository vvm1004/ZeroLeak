import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({
    plugins: [react()],
  }),
  manifest: {
    name: 'ZeroLeak & PhishGuard',
    description: 'On-Device DLP & Visual Phishing Threat Isolation',
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
      default_title: 'ZeroLeak & PhishGuard Shield',
    },
  },
});
