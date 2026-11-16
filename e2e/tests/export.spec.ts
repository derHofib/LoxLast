import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test('Export gesperrt durch Fehler, Sprung zum Element, nach dem Beheben nur noch „Vorlage fehlt“', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await page.getByLabel('Projektname').fill(`Export ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Lastverteilung' })).toBeVisible();

  // Cluster, Gruppe, ein Ladepunkt; Cluster-Limit unter den Mindeststrom setzen
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

  await page.getByRole('tab', { name: 'Export' }).click();
  const button = page.getByRole('button', { name: 'Vorlagen erzeugen & herunterladen' });
  await expect(button).toBeDisabled();
  await expect(page.getByText(/Export gesperrt: \d+ Fehler offen/)).toBeVisible();
  await expect(page.getByText('Noch nie exportiert')).toBeVisible();
  await expect(page.getByText('Original bleibt unverändert.')).toBeVisible();
  await expectNoViolations(page);

  // Sprung aus der Blocker-Liste zum Cluster
  await page
    .getByRole('list', { name: 'Export-Blocker' })
    .getByRole('button', { name: /Mindeststrom-Summe/ })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: 'UV-1' })).toBeVisible();
  await page.getByLabel('Limit').fill('63');
  await page.getByLabel('Limit').blur();

  // Zurück: ggf. bleiben Blocker aus dem Modell, sonst nur noch die fehlende Vorlage
  await page.getByRole('tab', { name: 'Export' }).click();
  await expect(page.getByText(/Mindeststrom-Summe/)).toHaveCount(0);
  await expect(button).toBeDisabled();
  await expect(page.getByText(/Die Loxone-Vorlage fehlt noch/)).toBeVisible();
  await expectNoViolations(page);
});
