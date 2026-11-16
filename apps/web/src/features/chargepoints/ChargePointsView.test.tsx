import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '@lastplan/core';
import { startChecks } from '../../state/checksStore';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { sampleProject } from '../../test-fixtures';
import { ChargePointsView } from './ChargePointsView';
import { TEST_MODEL_2_ID, TEST_MODEL_ID, testLibrary } from './testLibrary';

const library = testLibrary();
const store = () => useProjectStore.getState();
const project = () => store().project as Project;

function setup(mutate: (p: Project) => void = () => {}, selected: number[] = [0]) {
  const p = sampleProject();
  p.chargePoints.forEach((cp) => (cp.libraryModelId = TEST_MODEL_ID));
  mutate(p);
  store().open(p);
  useEditorStore.getState().select(selected.map((i) => p.chargePoints[i]!.id));
  return render(<ChargePointsView library={library} />);
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

beforeEach(() => {
  store().close();
  useEditorStore.getState().clearSelection();
});

describe('Ladepunkte-Ansicht', () => {
  it('zeigt Titel mit Modellname, Pfad und die Felder des Ladepunkts', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'LP01 · Test Testmodell' })).toBeTruthy();
    expect(screen.getAllByText('UV-TG1 › Mieter').length).toBeGreaterThan(0);
    expect(field('IP-Adresse').value).toBe('192.168.10.21');
    expect(field('Mindeststrom').value).toBe('6');
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText(/Benötigt das Gateway: unter Infos/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'CSV-Import' })).toHaveProperty('disabled', true);
  });

  it('fehlende Angaben aus dem Import: Vermerk am Feld, Nachtragen oder Bestätigen hebt ihn auf', async () => {
    const user = userEvent.setup();
    setup((p) => {
      p.chargePoints[0]!.missingFields = ['minA', 'phases'];
    });
    expect(screen.getAllByText(/Fehlt – Platzhalter, bitte nachtragen/)).toHaveLength(2);
    // Nachtragen: gleicher Wert reicht nicht, Bestätigen schon
    await user.click(screen.getAllByRole('button', { name: 'Wert bestätigen' })[0]!);
    expect(project().chargePoints[0]!.missingFields).toEqual(['phases']);
    expect(store().past.at(-1)?.label).toBe('Angabe bestätigen');
    await user.selectOptions(screen.getByLabelText('Phasen'), '1');
    expect(project().chargePoints[0]).not.toHaveProperty('missingFields');
    expect(screen.queryByText(/Fehlt – Platzhalter/)).toBeNull();
  });

  it('leerer Zustand ohne Gruppe legt Cluster und Gruppe an (ein Undo-Schritt)', async () => {
    const user = userEvent.setup();
    store().open({ ...sampleProject(), clusters: [], groups: [], chargePoints: [] });
    render(<ChargePointsView library={library} />);
    await user.click(screen.getByRole('button', { name: 'Cluster und Gruppe anlegen' }));
    expect(project().groups).toHaveLength(1);
    expect(store().past).toHaveLength(1);
    // jetzt ist „+ Ladepunkt“ möglich und legt den ersten Ladepunkt mit Bibliotheksmodell an
    await user.click(screen.getByRole('button', { name: '+ Ladepunkt' }));
    expect(project().chargePoints).toHaveLength(1);
    expect(project().chargePoints[0]!.libraryModelId).not.toBe('');
  });

  it('Feldänderung wird beim Verlassen übernommen und ist rückgängig', async () => {
    const user = userEvent.setup();
    setup();
    await user.clear(field('Mindeststrom'));
    await user.type(field('Mindeststrom'), '8');
    await user.tab();
    expect(project().chargePoints[0]!.minA).toBe(8);
    store().undo();
    expect(project().chargePoints[0]!.minA).toBe(6);
  });

  it('ungültige IP zeigt Meldung am Feld und ändert nichts', async () => {
    const user = userEvent.setup();
    setup();
    await user.clear(field('IP-Adresse'));
    await user.type(field('IP-Adresse'), '999.1.1.1');
    await user.tab();
    expect(screen.getByRole('alert').textContent).toContain('Ungültige IPv4-Adresse');
    expect(project().chargePoints[0]!.network.ip).toBe('192.168.10.21');
  });

  it('schlägt die nächste freie IP vor und übernimmt sie auf Klick', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '192.168.10.24 übernehmen' }));
    expect(project().chargePoints[0]!.network.ip).toBe('192.168.10.24');
  });

  describe('Standardwerte aus der Bibliothek', () => {
    it('Testmodell setzt Port, Unit-ID und Strom', async () => {
      const user = userEvent.setup();
      setup((p) => {
        p.chargePoints[0]!.libraryModelId = 'abl/em4-twin@1';
        p.chargePoints[0]!.network.port = 5020;
        p.chargePoints[0]!.maxA = 16;
      });
      await user.selectOptions(field('Hersteller'), 'Test');
      await user.selectOptions(field('Modell'), TEST_MODEL_ID);
      const cp = project().chargePoints[0]!;
      expect(cp.libraryModelId).toBe(TEST_MODEL_ID);
      expect(cp.network).toMatchObject({ port: 1502, unitId: 3, ip: '192.168.10.21' });
      expect(cp.maxA).toBe(20);
      expect(screen.getByText(/Standardwerte aus der Bibliothek übernommen/)).toBeTruthy();
      expect(store().past).toHaveLength(1);
    });

    it('Hersteller mit nur einem Modell: Modell gilt sofort, auch für mehrere Ladepunkte', async () => {
      const user = userEvent.setup();
      setup(
        (p) => p.chargePoints.forEach((cp) => (cp.libraryModelId = 'abl/em4-twin@1')),
        [0, 1],
      );
      await user.selectOptions(field('Hersteller'), 'Test');
      expect(project().chargePoints.slice(0, 2).map((c) => c.libraryModelId)).toEqual([
        TEST_MODEL_ID,
        TEST_MODEL_ID,
      ]);
      expect((field('Modell') as unknown as HTMLSelectElement).value).toBe(TEST_MODEL_ID);
      expect(store().past).toHaveLength(1);
    });

    it('Herstellerwechsel: Modell zeigt den Platzhalter, bis eines gewählt ist', async () => {
      const user = userEvent.setup();
      const p = sampleProject();
      p.chargePoints.forEach((cp) => (cp.libraryModelId = 'abl/em4-twin@1'));
      store().open(p);
      useEditorStore.getState().select([p.chargePoints[0]!.id]);
      render(<ChargePointsView library={testLibrary({ second: true })} />);
      await user.selectOptions(field('Hersteller'), 'Test');
      const model = field('Modell') as unknown as HTMLSelectElement;
      // vorher zeigte die Auswahl „Testmodell“ an, obwohl noch das ABL-Modell galt
      expect(model.value).toBe('');
      expect(model.selectedOptions[0]?.textContent).toBe('Modell wählen');
      expect(project().chargePoints[0]!.libraryModelId).toBe('abl/em4-twin@1');
      await user.selectOptions(model, TEST_MODEL_2_ID);
      expect(project().chargePoints[0]!.libraryModelId).toBe(TEST_MODEL_2_ID);
    });

    it('TODO-Modell setzt nichts und weist darauf hin', async () => {
      const user = userEvent.setup();
      setup((p) => {
        p.chargePoints[0]!.network.port = 5020;
        p.chargePoints[0]!.network.unitId = 9;
      });
      await user.selectOptions(field('Hersteller'), 'ABL');
      await user.selectOptions(field('Modell'), 'abl/em4-twin@1');
      const cp = project().chargePoints[0]!;
      expect(cp.libraryModelId).toBe('abl/em4-twin@1');
      expect(cp.network).toMatchObject({ port: 5020, unitId: 9 });
      expect(cp.minA).toBe(6);
      expect(screen.getByText(/enthält noch keine Standardwerte \(TODO\)/)).toBeTruthy();
    });
  });

  describe('Mehrfachauswahl', () => {
    const multi = () =>
      setup(
        (p) => {
          p.chargePoints[1]!.minA = 8;
        },
        [0, 1],
      );

    it('zeigt abweichende Werte als „verschieden“ und sperrt IP und Bezeichnung', () => {
      multi();
      expect(screen.getByRole('heading', { name: '2 Ladepunkte ausgewählt' })).toBeTruthy();
      expect(field('Mindeststrom').value).toBe('');
      expect(field('Mindeststrom').placeholder).toBe('verschieden');
      expect(field('Maximalstrom').value).toBe('16');
      expect(field('IP-Adresse').disabled).toBe(true);
      expect(field('Bezeichnung').disabled).toBe(true);
      expect((field('Phasenlage') as unknown as HTMLSelectElement).selectedOptions[0]!.text).toBe(
        'verschieden',
      );
    });

    it('Änderung gilt für alle Ausgewählten als EIN Undo-Schritt', async () => {
      const user = userEvent.setup();
      multi();
      await user.type(field('Mindeststrom'), '10');
      await user.tab();
      expect(project().chargePoints.map((c) => c.minA)).toEqual([10, 10, 6]);
      expect(store().past).toHaveLength(1);
      store().undo();
      expect(project().chargePoints.map((c) => c.minA)).toEqual([6, 8, 6]);
    });

    it('Port-Änderung belässt die IP-Adressen', async () => {
      const user = userEvent.setup();
      multi();
      await user.click(screen.getByText('Erweiterte Parameter'));
      await user.clear(field('Port'));
      await user.type(field('Port'), '1503');
      await user.tab();
      expect(
        project()
          .chargePoints.slice(0, 2)
          .map((c) => [c.network.ip, c.network.port]),
      ).toEqual([
        ['192.168.10.21', 1503],
        ['192.168.10.22', 1503],
      ]);
    });

    it('Liste: Strg-Klick und Umschalt-Klick wählen mehrere', async () => {
      setup(() => {}, [0]);
      const list = screen.getByRole('listbox', { name: 'Ladepunkte' });
      fireEvent.click(within(list).getByText('LP03'), { ctrlKey: true });
      expect(useEditorStore.getState().selectedIds).toHaveLength(2);
      fireEvent.click(within(list).getByText('LP01'));
      fireEvent.click(within(list).getByText('LP03'), { shiftKey: true });
      expect(useEditorStore.getState().selectedIds).toHaveLength(3);
      fireEvent.keyDown(within(list).getAllByRole('option')[2]!, {
        key: 'ArrowUp',
        shiftKey: true,
      });
      expect(useEditorStore.getState().selectedIds).toHaveLength(2);
    });
  });

  it('„Speichern & nächster LP“ übernimmt offene Eingaben und springt weiter', async () => {
    const user = userEvent.setup();
    setup();
    await user.clear(field('Raum'));
    await user.type(field('Raum'), 'Tor 1');
    await user.click(screen.getByRole('button', { name: /Speichern & nächster LP/ }));
    expect(project().chargePoints[0]!.room).toBe('Tor 1');
    expect(useEditorStore.getState().selectedIds).toEqual([project().chargePoints[1]!.id]);
    expect(screen.getByRole('heading', { name: /^LP02/ })).toBeTruthy();
  });

  it('Kürzel / fokussiert die Suche, N legt einen Ladepunkt in der Gruppe an', () => {
    setup();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: 'Ladepunkte durchsuchen' }),
    );
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Ladepunkte durchsuchen' }), {
      key: 'n',
    });
    expect(project().chargePoints).toHaveLength(3); // in Eingabefeld wirkungslos
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(project().chargePoints).toHaveLength(4);
    expect(project().chargePoints[3]!.groupId).toBe(project().chargePoints[0]!.groupId);
  });

  it('Suche filtert die Liste', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('searchbox', { name: 'Ladepunkte durchsuchen' }), 'LP03');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
  });

  it('Eigenschaftenfilter blendet Felder aus', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('searchbox', { name: 'Eigenschaften filtern' }), 'strom');
    expect(screen.queryByLabelText('IP-Adresse')).toBeNull();
    expect(screen.getByLabelText('Mindeststrom')).toBeTruthy();
  });
});

describe('Infos-Spalte', () => {
  it('Modell mit Lücken: „unvollständig“, jede Lücke als „fehlt (TODO)“, Export gesperrt', () => {
    setup((p) => {
      p.chargePoints[0]!.libraryModelId = 'abl/em4-twin@1';
    });
    const info = screen.getByRole('complementary', { name: 'Infos' });
    expect(within(info).getByText('Gateway nicht gekoppelt')).toBeTruthy();
    expect(within(info).getByText(/^unvollständig \(\d+ Angaben fehlen\)/)).toBeTruthy();
    expect(within(info).getAllByText('fehlt (TODO)').length).toBeGreaterThan(30);
    expect(
      within(info).getByText(/Export gesperrt, bis die Herstellerdoku eingetragen ist/),
    ).toBeTruthy();
    expect(within(info).getByText('abl/em4-twin@1')).toBeTruthy();
  });

  it('vollständiges Modell: „vollständig“ ohne Lücken', () => {
    setup();
    const info = screen.getByRole('complementary', { name: 'Infos' });
    expect(within(info).getByText('vollständig')).toBeTruthy();
    expect(within(info).queryByText('fehlt (TODO)')).toBeNull();
    expect(within(info).queryByText(/Export gesperrt/)).toBeNull();
  });

  it('zeigt Prüfmeldungen zum Ladepunkt inklusive MODEL_INCOMPLETE', () => {
    const p = sampleProject();
    p.chargePoints[0]!.libraryModelId = 'abl/em4-twin@1';
    store().open(p);
    useEditorStore.getState().select([p.chargePoints[0]!.id]);
    const stop = startChecks(undefined, 0);
    render(<ChargePointsView library={library} />);
    expect(screen.getByText(/MODEL_INCOMPLETE/)).toBeTruthy();
    expect(screen.getAllByText(/Export gesperrt/).length).toBeGreaterThan(0);
    stop();
  });
});
