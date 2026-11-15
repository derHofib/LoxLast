import { defineConfig } from '@playwright/test';

// Lokal kann ein vorinstallierter Browser genutzt werden: PLAYWRIGHT_CHROMIUM_PATH=/pfad/zu/chromium
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'de-DE',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: 'pnpm --filter @lastplan/web dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    cwd: '..',
  },
});
