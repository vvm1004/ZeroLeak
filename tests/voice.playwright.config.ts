import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'voice.spec.ts', fullyParallel: false, workers: 1,
  timeout: 30000, expect: { timeout: 10000 }, reporter: 'list',
  outputDir: '../test-results/voice',
  webServer: {
    command: 'pnpm --filter @zeroleak/sandbox-api exec tsx test/voice-e2e-server.ts',
    url: 'http://127.0.0.1:18080/health', reuseExistingServer: false,
    env: { VOICE_E2E: '1' },
  },
});
