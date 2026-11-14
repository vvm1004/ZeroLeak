import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

const rootEnvPath = path.resolve(process.cwd(), '../../.env');
if (fs.existsSync(rootEnvPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(rootEnvPath);
  } catch {
   
  }
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  vite: () => ({
    plugins: [react()],
    define: {
      'process.env.SANDBOX_API_URL': JSON.stringify(
        process.env.SANDBOX_API_URL || 'http://localhost:8080'
      ),
    },
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
