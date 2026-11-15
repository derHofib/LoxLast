import { expect, test, type Page } from '@playwright/test';

async function createProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await page.getByLabel('Projektname').fill(name);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('tab', { name: 'Struktur' })).toBeVisible();
}

test('Projekt anlegen, umbenennen, nach Neuladen wieder öffnen', async ({ page }) => {
  const name = `Tiefgarage ${Date.now()}`;
  await createProject(page, name);

  const field = page.getByLabel('Projektname');
  await field.fill(`${name} neu`);
  await field.blur();
  // Erst „ungespeichert“ (Entprellung), dann „Gespeichert“ – sonst wäre der Anfangszustand ein falscher Treffer
  await expect(page.getByText('Ungespeicherte Änderungen')).toBeVisible();
  await expect(page.getByText('Gespeichert', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Projektname')).toHaveValue(`${name} neu`);

  await page.getByRole('link', { name: 'LastPlan – zur Projektübersicht' }).click();
  await expect(page.getByRole('link', { name: `${name} neu` })).toBeVisible();
});

test('Undo/Redo per Tastatur', async ({ page }) => {
  const name = `Undo ${Date.now()}`;
  await createProject(page, name);

  const field = page.getByLabel('Projektname');
  await field.fill('Geändert');
  await field.blur();
  await expect(field).toHaveValue('Geändert');

  await page.keyboard.press('Control+z');
  await expect(field).toHaveValue(name);
  await page.keyboard.press('Control+Shift+z');
  await expect(field).toHaveValue('Geändert');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await expect(field).toHaveValue('Geändert');
});

test('Tabs per Pfeiltasten', async ({ page }) => {
  await createProject(page, `Tabs ${Date.now()}`);
  await page.getByRole('tab', { name: 'Struktur' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Ladepunkte' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page).toHaveURL(/\/ladepunkte$/);
});

test('Projekt exportieren und wieder importieren', async ({ page }) => {
  const name = `Export ${Date.now()}`;
  await createProject(page, name);
  await expect(page.getByText('Gespeichert')).toBeVisible();
  await page.goto('/');

  const row = page.getByRole('listitem').filter({ hasText: name });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: `${name} exportieren` }).click(),
  ]);
  const path = await download.path();
  expect(download.suggestedFilename()).toMatch(/\.lastplan\.json$/);

  await page.getByLabel('Projektdatei wählen').setInputFiles(path);
  await expect(page.getByLabel('Projektname')).toHaveValue(name);
});

test('Fehlerhafte Importdatei zeigt Meldung mit Lösung', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Projektdatei wählen').setInputFiles({
    name: 'kaputt.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{nope'),
  });
  await expect(page.getByRole('alert')).toContainText('Import fehlgeschlagen');
  await expect(page.getByRole('alert')).toContainText('Lösung:');
});
