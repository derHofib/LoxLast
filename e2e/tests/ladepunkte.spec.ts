import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Projekt mit Cluster/Gruppe und drei Ladepunkten LP01–LP03 im Tab „Ladepunkte“. */
async function projectWithThreeChargePoints(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await page.getByLabel('Projektname').fill(`Ladepunkte ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.getByRole('tab', { name: 'Ladepunkte' }).click();
  await page.getByRole('button', { name: 'Cluster und Gruppe anlegen' }).click();
  const add = page.getByRole('button', { name: '+ Ladepunkt' });
  for (let i = 0; i < 3; i++) await add.click();
  await expect(list(page).getByRole('option')).toHaveCount(3);
}

const list = (page: Page) => page.getByRole('listbox', { name: 'Ladepunkte' });
const option = (page: Page, label: string) =>
  list(page).getByRole('option', { name: new RegExp(label) });

test('Ladepunkte anlegen, bearbeiten, gemeinsam den Mindeststrom ändern und Undo', async ({
  page,
}) => {
  await projectWithThreeChargePoints(page);

  // Der zuletzt angelegte Ladepunkt ist gewählt; IP wurde fortgezählt
  await expect(page.getByRole('heading', { name: /^LP03/ })).toBeVisible();
  await expect(page.getByLabel('IP-Adresse')).toHaveValue(/^192\.168\.1\.\d+$/);

  // Einzeln bearbeiten
  await option(page, 'LP01').click();
  await page.getByLabel('Bezeichnung').fill('Tor Nord');
  await page.getByLabel('Bezeichnung').blur();
  await expect(option(page, 'Tor Nord')).toBeVisible();

  // Alle drei gemeinsam: Umschalt-Klick über den Bereich
  await option(page, 'Tor Nord').click();
  await option(page, 'LP03').click({ modifiers: ['Shift'] });
  await expect(page.getByRole('heading', { name: '3 Ladepunkte ausgewählt' })).toBeVisible();
  await expect(page.getByLabel('IP-Adresse')).toBeDisabled();

  const min = page.getByLabel('Mindeststrom');
  await min.fill('8');
  await min.blur();

  // Einzelansicht zeigt den neuen Wert bei jedem Ladepunkt
  for (const name of ['Tor Nord', 'LP02', 'LP03']) {
    await option(page, name).click();
    await expect(page.getByLabel('Mindeststrom')).toHaveValue('8');
  }

  // Ein Undo-Schritt macht alle drei rückgängig
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  for (const name of ['Tor Nord', 'LP02', 'LP03']) {
    await option(page, name).click();
    await expect(page.getByLabel('Mindeststrom')).toHaveValue('6');
  }
});

test('Kürzel N legt einen Ladepunkt an, / fokussiert die Suche', async ({ page }) => {
  await projectWithThreeChargePoints(page);
  await page.getByRole('heading', { name: /^LP03/ }).click();
  await page.keyboard.press('n');
  await expect(list(page).getByRole('option')).toHaveCount(4);
  // N fokussiert die IP-Adresse des neuen Ladepunkts; für das Kürzel den Fokus aus dem Feld nehmen
  await page.getByRole('heading', { name: /^LP04/ }).click();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Ladepunkte durchsuchen' })).toBeFocused();
});

test('Modell mit Lücken (ABL) ist als „unvollständig“ markiert', async ({ page }) => {
  await projectWithThreeChargePoints(page);
  await page.getByLabel('Hersteller').selectOption('ABL');
  await page.getByLabel('Modell', { exact: true }).selectOption('abl/em4-twin@1');

  const info = page.getByRole('complementary', { name: 'Infos' });
  await expect(info.getByText(/^unvollständig \(\d+ Angaben fehlen\)/)).toBeVisible();
  await expect(info.getByText('fehlt (TODO)').first()).toBeVisible();
  await expect(info.getByText(/Export gesperrt, bis die Herstellerdoku/)).toBeVisible();
  await expect(info.getByText(/MODEL_INCOMPLETE/)).toBeVisible();
});

test('Ladepunkte-Ansicht ohne axe-Verstöße', async ({ page }) => {
  await projectWithThreeChargePoints(page);
  await page.getByLabel('Hersteller').selectOption('ABL');
  await page.getByLabel('Modell', { exact: true }).selectOption('abl/em4-twin@1');
  await page.getByText('Erweiterte Parameter').click();
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});
