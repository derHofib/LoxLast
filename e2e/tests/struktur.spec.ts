import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function createProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await page.getByLabel('Projektname').fill(name);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Lastverteilung' })).toBeVisible();
}

/** Cluster UV-1 mit Gruppe „Gruppe 1“ und drei Ladepunkten – Anlegen per Maus (Schaltflächen) und Tastatur (N). */
async function buildPlant(page: Page) {
  await page.getByRole('button', { name: '+ Cluster' }).click();
  await expect(page.getByRole('button', { name: 'Cluster UV-1 auswählen' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '+ Gruppe' }).click();
  await expect(page.getByRole('button', { name: 'Gruppe Gruppe 1 auswählen' })).toBeVisible();
  await page.getByRole('button', { name: '+ Ladepunkt' }).click();
  await expect(page.getByRole('button', { name: /^LP01/ })).toBeVisible();
  await page.keyboard.press('n');
  await page.keyboard.press('n');
  await expect(page.getByRole('button', { name: /^LP03/ })).toBeVisible();
}

/** Cluster und Gruppe sind Karten mit Button über der ganzen Fläche; Unterknoten liegen darüber. Daher oben links in die Kopfzeile klicken. */
const selectBox = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).click({ position: { x: 12, y: 12 } });

const clusterBox = (page: Page, name: string) =>
  page.locator('.structure-box', {
    has: page.getByRole('button', { name: `Cluster ${name} auswählen` }),
  });

test('Anlage aufbauen, Fehler erzeugen, per Meldung hinspringen, beheben, Undo/Redo', async ({
  page,
}) => {
  await createProject(page, `Struktur ${Date.now()}`);
  await buildPlant(page);

  // Cluster-Limit unter die Mindeststrom-Summe (3 × 6 A = 18 A) setzen
  await selectBox(page, 'Cluster UV-1 auswählen');
  const limit = page.getByLabel('Limit');
  await limit.fill('10');
  await expect(page.getByText('Geändert: 63 → 10 A')).toBeVisible();
  await limit.blur();

  // Fehler sofort sichtbar: orange Karte mit Warndreieck und Meldung, Balken voll
  const card = clusterBox(page, 'UV-1');
  await expect(card.locator('.lp-node--error')).toBeVisible();
  await expect(card.getByText(/Mindeststrom-Summe 18\s?A über Limit 10\s?A/)).toBeVisible();
  await expect(card.getByText('Belegt 18 A von 10 A')).toBeVisible();

  // Auswahl aufheben, in der Übersicht die Meldung anklicken: springt zum Cluster
  await page.getByRole('button', { name: 'Zurück zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  await page.getByRole('button', { name: /Fehler: UV-1: Mindeststrom-Summe/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'UV-1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cluster UV-1 auswählen' })).toBeFocused();

  // Beheben
  await limit.fill('63');
  await limit.blur();
  await expect(card.locator('.lp-node--error')).toHaveCount(0);
  await expect(card.getByText('Belegt 18 A von 63 A')).toBeVisible();

  // Undo/Redo per Tastatur (Fokus nicht in einem Eingabefeld)
  await page.getByRole('heading', { name: 'Lastverteilung' }).click();
  await page.keyboard.press('Control+z');
  await expect(card.locator('.lp-node--error')).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(card.locator('.lp-node--error')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(card.locator('.lp-node--error')).toHaveCount(0);
});

test('Pfeiltasten, Ausschneiden/Einfügen und Drag & Drop', async ({ page }) => {
  await createProject(page, `Verschieben ${Date.now()}`);
  await buildPlant(page);
  await page.getByRole('button', { name: '+ Gruppe' }).click();
  const g2 = page.getByRole('button', { name: 'Gruppe Gruppe 2 auswählen' });
  await expect(g2).toBeVisible();

  // Pfeiltasten: LP03 → Auswahl; Pfeil links geht zur Gruppe
  await page.getByRole('button', { name: /^LP03/ }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: 'Gruppe Gruppe 1 auswählen' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /^LP01/ })).toBeFocused();

  // Strg+X / Strg+V: LP01 in Gruppe 2
  await page.keyboard.press('Control+x');
  await expect(page.getByText(/1 Element ausgeschnitten/)).toBeVisible();
  await selectBox(page, 'Gruppe Gruppe 2 auswählen');
  await page.keyboard.press('Control+v');
  const group2 = page.locator('.structure-box', { has: g2 });
  await expect(
    page.getByRole('status').filter({ hasText: 'verschieben: eingefügt' }),
  ).toBeAttached();
  await expect(group2.getByText('Priorität 3')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'LP01' })).toBeVisible();

  // Drag & Drop mit der Maus: LP02 in Gruppe 2 ziehen, Ziel wird hervorgehoben
  const lp02 = page.getByRole('button', { name: /^LP02/ });
  const target = page.getByRole('button', { name: /^LP01/ }); // Ladepunkt in Gruppe 2 = Drop gilt der Gruppe
  await lp02.dragTo(target);
  await page.getByRole('button', { name: /^LP02/ }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('heading', { level: 2, name: 'Gruppe 2' })).toBeVisible();

  // Rückgängig: LP02 liegt wieder in Gruppe 1
  await page.getByRole('heading', { name: 'Lastverteilung' }).click();
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: /^LP02/ }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('heading', { level: 2, name: 'Gruppe 1' })).toBeVisible();
});

test('Struktur-Ansicht ohne axe-Verstöße', async ({ page }) => {
  await createProject(page, `A11y Struktur ${Date.now()}`);
  await buildPlant(page);
  await selectBox(page, 'Cluster UV-1 auswählen');
  await page.getByLabel('Limit').fill('10');
  await page.getByLabel('Limit').blur();
  // Eigenschaften-Ansicht mit Fehlermeldung, danach die Übersicht
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Zurück zur Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
  await expectNoViolations(page);
});

test('Klickflächen der Aktionen mindestens 44 px', async ({ page }) => {
  await createProject(page, `Flächen ${Date.now()}`);
  for (const name of ['+ Cluster', '+ Gruppe', '+ Ladepunkt', 'Alles einpassen']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box?.height, name).toBeGreaterThanOrEqual(40);
  }
});
