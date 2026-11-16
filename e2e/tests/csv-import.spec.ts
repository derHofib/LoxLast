import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** 20 Ladepunkte, Semikolon wie im deutschen Excel. IPs aus dem Dokumentationsnetz. */
function csv20(): string {
  const lines = ['Bezeichnung;Gruppe;Modell-ID;IP-Adresse;Min. Strom (A)'];
  for (let i = 1; i <= 20; i++) {
    lines.push(
      `TG-${String(i).padStart(2, '0')};Gruppe 1;abl/em4-twin@1;192.0.2.${String(10 + i)};6`,
    );
  }
  return lines.join('\r\n') + '\r\n';
}

test('Abnahme MS 5: 20 Ladepunkte per CSV, Mindeststrom gemeinsam ändern, ABL unvollständig', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await page.getByLabel('Projektname').fill(`CSV ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.getByRole('tab', { name: 'Ladepunkte' }).click();
  await page.getByRole('button', { name: 'Cluster und Gruppe anlegen' }).click();

  await page.getByRole('button', { name: 'CSV-Import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ladepunkte aus CSV importieren' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('CSV-Datei wählen').setInputFiles({
    name: 'ladepunkte.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv20(), 'utf-8'),
  });
  await dialog.getByRole('button', { name: 'Weiter zur Vorschau' }).click();
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: '20 fehlerfreie Zeilen importieren' }).click();
  await expect(dialog).toBeHidden();

  const list = page.getByRole('listbox', { name: 'Ladepunkte' });
  await expect(list.getByRole('option')).toHaveCount(20);

  // Alle gemeinsam: Mindeststrom auf 8 A
  await list.getByRole('option', { name: /TG-01/ }).click();
  await list.getByRole('option', { name: /TG-20/ }).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('heading', { name: '20 Ladepunkte ausgewählt' })).toBeVisible();
  const min = page.getByLabel('Mindeststrom');
  await min.fill('8');
  await min.blur();
  await list.getByRole('option', { name: /TG-13/ }).click();
  await expect(page.getByLabel('Mindeststrom')).toHaveValue('8');

  // Was in der Datei fehlte, ist am Ladepunkt markiert und wird in der Prüfung gemeldet
  await expect(page.getByText('Fehlt – Platzhalter, bitte nachtragen').first()).toBeVisible();
  await expect(page.getByText(/Angaben fehlen bei 20 Ladepunkten/).first()).toBeVisible();

  // ABL-Modell ohne Herstellerdoku: unvollständig, Export gesperrt
  const info = page.getByRole('complementary', { name: 'Infos' });
  await expect(info.getByText(/^unvollständig \(\d+ Angaben fehlen\)/)).toBeVisible();
  await expect(info.getByText(/Export gesperrt/).first()).toBeVisible();
});
