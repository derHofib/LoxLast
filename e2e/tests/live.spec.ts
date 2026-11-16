import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function openLive(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await page.getByLabel('Projektname').fill(`Live ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.getByRole('tab', { name: 'Live' }).click();
}

test('Live ohne Gateway: leerer Zustand mit Anleitung, ohne axe-Verstöße', async ({ page }) => {
  await openLive(page);
  await expect(page.getByText('Gateway nicht gekoppelt').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Noch keine Live-Werte' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gateway koppeln' })).toBeVisible();
  await expectNoViolations(page);
});

test('Live Demo-Daten: gekennzeichnet, Störung markiert, ohne axe-Verstöße', async ({ page }) => {
  await openLive(page);
  await page.getByRole('button', { name: 'Demo-Daten anzeigen' }).click();
  await expect(page.getByText('Demo – keine echten Werte')).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expectNoViolations(page);
});

test('Live offline: Gateway nicht erreichbar zeigt Getrennt/Wiederverbindung', async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'lastplan.gateway',
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:1',
        token: 'geheimes-token-1234567890',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ),
  );
  await openLive(page);
  await expect(page.getByText('Getrennt').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Noch keine Live-Werte' })).toBeVisible();
  await expectNoViolations(page);
});
