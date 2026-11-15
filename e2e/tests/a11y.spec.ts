import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test('Projektübersicht ohne axe-Verstöße', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projekte' })).toBeVisible();
  await expectNoViolations(page);
});

test('Komponentenseite ohne axe-Verstöße', async ({ page }) => {
  await page.goto('/#/komponenten');
  await expect(page.getByRole('heading', { name: 'Komponenten' })).toBeVisible();
  await expectNoViolations(page);
});

test('Projektansicht ohne axe-Verstöße', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await page.getByLabel('Projektname').fill('A11y');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('tab', { name: 'Struktur' })).toBeVisible();
  await expectNoViolations(page);
});

test('Klickflächen mindestens 40 px (Primärelemente 44 px)', async ({ page }) => {
  await page.goto('/');
  const box = await page.getByRole('button', { name: 'Neues Projekt' }).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});
