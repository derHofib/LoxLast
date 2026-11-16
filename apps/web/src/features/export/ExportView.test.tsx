import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerGenerator, unregisterGenerator } from '@lastplan/loxone-export';
import { startChecks } from '../../state/checksStore';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { toModelCatalog } from '@lastplan/wallbox-library';
import { TEST_MODEL_ID, testLibrary } from '../chargepoints/testLibrary';
import { sampleProject } from '../../test-fixtures';
import { ExportView } from './ExportView';
import { recordExportCommand } from './record';

const store = () => useProjectStore.getState();
let stop: () => void;
const catalog = toModelCatalog(testLibrary());

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function setup(mutate: (p: ReturnType<typeof sampleProject>) => void = () => {}) {
  const p = sampleProject();
  p.chargePoints.forEach((cp) => (cp.libraryModelId = TEST_MODEL_ID));
  mutate(p);
  store().open(p);
  stop = startChecks(catalog, 0);
  render(
    <MemoryRouter
      initialEntries={[`/projekt/${p.id}/export`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Where />
      <Routes>
        <Route path="/projekt/:id/export" element={<ExportView />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
  return p;
}

const button = () => screen.getByRole('button', { name: 'Vorlagen erzeugen & herunterladen' });

beforeEach(() => {
  store().close();
  useEditorStore.setState({ selectedIds: [], reveal: null, clipboard: null });
});
afterEach(() => {
  stop?.();
  unregisterGenerator('templates');
});

describe('Export-Ansicht', () => {
  it('ohne Generator: gesperrt mit Hinweis auf die fehlende Vorlage, Modus B deaktiviert', () => {
    setup();
    expect(button()).toHaveProperty('disabled', true);
    expect(screen.getByText(/Die Loxone-Vorlage fehlt noch\. Benötigt:/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Export-Blocker' })).toBeNull();
    expect(screen.getByRole('radio', { name: /In bestehendes Projekt/ })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText(/Folgt mit Meilenstein 7/)).toBeTruthy();
    expect(screen.getByText('Original bleibt unverändert.')).toBeTruthy();
  });

  it('mit Generator und ohne Blocker ist der Button frei', () => {
    registerGenerator({
      mode: 'templates',
      generate: () => Promise.reject(new Error('nicht aufgerufen')),
    });
    setup();
    expect(button()).toHaveProperty('disabled', false);
    expect(screen.queryByText(/Die Loxone-Vorlage fehlt noch/)).toBeNull();
  });

  it('zeigt die Zusammenfassung aus dem Projekt', () => {
    setup();
    const dl = within(screen.getByText('Wird erzeugt').closest('section')!);
    const value = (term: string) => dl.getByText(term).nextElementSibling?.textContent;
    expect(value('Lastmanager (Cluster)')).toBe('1');
    expect(value('Gruppen-Limits')).toBe('1');
    expect(value('Wallbox-Bausteine')).toBe('3');
    expect(value('Modbus-Geräte')).toBe('3');
    expect(value('Ein-/Ausgänge')).toBe('Wird mit der Vorlage festgelegt');
  });

  it('Logik-Vorschau nennt Projektdaten und markiert Ein-/Ausgänge als TODO(verify)', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Ebene 2 · Cluster' })).toBeTruthy();
    expect(screen.getByText('LP01')).toBeTruthy();
    expect(screen.getAllByText(/TODO\(verify\) – aus Vorlage/).length).toBeGreaterThan(4);
    expect(screen.getByRole('list', { name: 'Legende' })).toBeTruthy();
  });

  it('Blocker sperren den Export und springen zum Ladepunkt bzw. zur Struktur', async () => {
    const user = userEvent.setup();
    const p = setup((q) => {
      q.chargePoints[0]!.minA = 20; // Min > Max
    });
    expect(button()).toHaveProperty('disabled', true);
    const list = screen.getByRole('list', { name: 'Export-Blocker' });
    const jump = within(list).getAllByRole('button')[0]!;
    await user.click(jump);
    expect(screen.getByTestId('where').textContent).toBe(`/projekt/${p.id}/ladepunkte`);
    expect(useEditorStore.getState().selectedIds).toContain(p.chargePoints[0]!.id);
  });

  it('Blocker an Cluster/Gruppe springen in den Struktur-Tab', async () => {
    const user = userEvent.setup();
    const p = setup((q) => {
      q.clusters[0]!.limitA = 10; // unter der Mindeststrom-Summe
    });
    await user.click(
      within(screen.getByRole('list', { name: 'Export-Blocker' })).getAllByRole('button')[0]!,
    );
    expect(screen.getByTestId('where').textContent).toBe(`/projekt/${p.id}/struktur`);
    expect(useEditorStore.getState().selectedIds).toContain(p.clusters[0]!.id);
  });

  it('Letzter Export: „Noch nie exportiert“, danach Datum; Banner erst bei Strukturänderung', () => {
    const p = setup();
    expect(screen.getByText('Noch nie exportiert')).toBeTruthy();
    expect(screen.queryByText('Struktur seit dem letzten Export geändert')).toBeNull();
    stop();
    document.body.innerHTML = '';
    store().close();
    const q = structuredClone(p);
    q.exportHistory = [];
    store().open(q);
    store().execute(
      recordExportCommand(store().project!, {
        mode: 'templates',
        configVersion: '99.0',
        now: new Date('2026-03-04T10:00:00Z'),
      }),
    );
    store().execute({
      label: 'x',
      recipe: (d) => {
        d.clusters[0]!.name = 'Anders';
      },
    });
    stop = startChecks(catalog, 0);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ExportView />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Nur Vorlagen · Config-Version 99\.0/)).toBeTruthy();
    expect(screen.getByText('Struktur seit dem letzten Export geändert')).toBeTruthy();
  });
});
