import { defineConfig } from '@playwright/test';

// Lokal kann ein vorinstallierter Browser genutzt werden: PLAYWRIGHT_CHROMIUM_PATH=/pfad/zu/chromium
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
// Eigener Port je Arbeitskopie, damit parallele Läufe sich nicht den Dev-Server teilen: E2E_PORT=5181
const port = Number(process.env['E2E_PORT'] ?? 5173);
const baseURL = `http://localhost:${String(port)}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'de-DE',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `pnpm --filter @lastplan/web dev --port ${String(port)} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    cwd: '..',
  },
});
