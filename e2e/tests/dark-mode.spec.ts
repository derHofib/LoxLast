import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

const theme = (page: Page) => page.locator('html').getAttribute('data-theme');

test('System folgt dem Betriebssystem, Wahl bleibt nach dem Neuladen erhalten', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projekte' })).toBeVisible();
  expect(await theme(page)).toBe('dark');
  await expect(page.getByRole('button', { name: 'System' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => theme(page)).toBe('light');

  await page.getByRole('button', { name: 'Dunkel' }).click();
  expect(await theme(page)).toBe('dark');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Projekte' })).toBeVisible();
  expect(await theme(page)).toBe('dark');
  await expect(page.getByRole('button', { name: 'Dunkel' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

for (const mode of ['Hell', 'Dunkel'] as const) {
  test(`Alle Ansichten im Modus „${mode}“ ohne axe-Verstöße`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: mode }).click();
    await expect(page.getByRole('button', { name: mode })).toHaveAttribute('aria-pressed', 'true');
    await expectNoViolations(page);

    await page.goto('/#/komponenten');
    await expect(page.getByRole('heading', { name: 'Komponenten' })).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/#/');
    await page.getByRole('button', { name: 'Neues Projekt' }).click();
    await page.getByLabel('Projektname').fill(`Dark ${mode} ${Date.now()}`);
    await page.getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.getByRole('heading', { name: 'Lastverteilung' })).toBeVisible();

    // Cluster mit zu niedrigem Limit, damit auch Fehler-/Warnfarben geprüft werden
    await page.getByRole('button', { name: '+ Cluster' }).click();
    await page.getByRole('button', { name: '+ Gruppe' }).click();
    await page.getByRole('button', { name: '+ Ladepunkt' }).click();
    await expect(page.getByRole('button', { name: /^LP01/ })).toBeVisible();
    await page
      .getByRole('button', { name: 'Cluster UV-1 auswählen' })
      .click({ position: { x: 12, y: 12 } });
    const limit = page.getByLabel('Limit');
    await limit.fill('3');
    await limit.blur();
    await expectNoViolations(page);

    for (const tab of ['Ladepunkte', 'Export', 'Live']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      await expectNoViolations(page);
    }
  });
}
