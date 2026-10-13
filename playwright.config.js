import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './tests/browser',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173/ancient-text-transcriber/', viewport: { width: 1440, height: 1100 }, trace: 'retain-on-failure', launchOptions: { executablePath } },
  webServer: { command: 'node scripts/serve-static.mjs', url: 'http://127.0.0.1:4173/ancient-text-transcriber/', reuseExistingServer: false },
});
