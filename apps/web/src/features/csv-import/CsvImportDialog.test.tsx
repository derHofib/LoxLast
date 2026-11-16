import '@testing-library/jest-dom/vitest';
import { catalogFromModels, type CatalogModel, type Project } from '@lastplan/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { sampleProject } from '../../test-fixtures';
import { CsvImportDialog } from './CsvImportDialog';
import { decodeCsvBytes } from './readFile';

/** Testmodell, kein reales Wallbox-Modell (siehe test-fixtures). */
const TEST_MODEL: CatalogModel = {
  id: 'test/wallbox@1',
  displayName: 'Testwallbox',
  complete: true,
  missingFields: [],
  electrical: { minA: 6, maxA: 32, phases: [1, 3], phaseSwitching: false },
};
const catalog = catalogFromModels([TEST_MODEL]);

const s = () => useProjectStore.getState();
const p = () => s().project as Project;

/** 20 Ladepunkte, Zeile 7 mit ungültiger IP, Zeile 14 mit unbekannter Gruppe. */
function twentyRowCsv(): string {
  const lines = [
    'Ladepunkt;Gruppe;Modell-ID;IP-Adresse;Min. Strom (A);Max. Strom (A);Phasenlage;Absicherung (A);Phasen;Phasenumschaltung',
  ];
  for (let i = 0; i < 20; i++) {
    const ip = i === 5 ? '192.168.1.300' : `192.168.10.${100 + i}`;
    const group = i === 12 ? 'Unbekannt' : i % 2 === 0 ? 'Mieter' : 'UV-TG1 › Flotte';
    lines.push(
      `LP${10 + i};${group};test/wallbox@1;${ip};6,0;16 A;L${(i % 3) + 1}-L${((i + 1) % 3) + 1}-L${((i + 2) % 3) + 1};32;3;nein`,
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const csvFile = (text: string, name = 'ladepunkte.csv') =>
  new File([text], name, { type: 'text/csv' });

function renderDialog(onClose = vi.fn(), onImported = vi.fn()) {
  render(<CsvImportDialog open onClose={onClose} onImported={onImported} catalog={catalog} />);
  return { onClose, onImported };
}

beforeEach(() => {
  s().open(sampleProject());
  useEditorStore.getState().clearSelection();
});

afterEach(() => vi.restoreAllMocks());

describe('CsvImportDialog', () => {
  it('ganzer Ablauf: 20 Zeilen, 2 fehlerhaft → 18 importiert, Undo entfernt alle', async () => {
    const user = userEvent.setup();
    const { onClose, onImported } = renderDialog();
    const before = JSON.stringify({ ...p(), updatedAt: '' });

    const dialog = screen.getByRole('dialog', { name: 'Ladepunkte aus CSV importieren' });
    expect(within(dialog).getByText('Datei wählen').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );

    // Schritt 1: Datei
    await user.upload(screen.getByLabelText('CSV-Datei wählen'), csvFile(twentyRowCsv()));

    // Schritt 2: Zuordnung ist vorgeschlagen
    await screen.findByText(/Zuordnung wurde vorgeschlagen/);
    expect(screen.getByText(/20 Zeilen · Trennzeichen Semikolon · UTF-8/)).toBeInTheDocument();
    expect(screen.getByLabelText('IP-Adresse *')).toHaveValue('3');
    expect(screen.getByLabelText('Bezeichnung *')).toHaveValue('0');
    expect(screen.getByLabelText('Min. Strom (A)')).toHaveValue('4');
    expect(screen.getByLabelText('Port')).toHaveValue('');
    expect(screen.getByText(/Beispiel aus der Datei: 192.168.10.100/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Weiter zur Vorschau' }));

    // Schritt 3: Vorschau
    expect(screen.getByRole('status')).toHaveTextContent(
      '20 Zeilen geprüft: 18 fehlerfrei, 2 mit Fehlern – werden nicht importiert.',
    );
    const rows = screen.getAllByTestId('preview-row');
    expect(rows).toHaveLength(20);
    expect(rows[5]).toHaveTextContent(
      'Fehler: Zeile 7, Spalte ‚IP-Adresse‘: 192.168.1.300 ist keine gültige IPv4-Adresse',
    );
    expect(rows[12]).toHaveTextContent('Fehler: Zeile 14, Spalte ‚Gruppe‘: Gruppe „Unbekannt“');
    expect(rows[1]).toHaveTextContent('UV-TG1 › Flotte');
    expect(rows[1]).toHaveTextContent('6 A – 16 A');
    expect(within(rows[0]!).getByText('OK')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Nur Zeilen mit Meldungen anzeigen' }));
    expect(screen.getAllByTestId('preview-row')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '18 fehlerfreie Zeilen importieren' }));

    expect(p().chargePoints).toHaveLength(3 + 18);
    expect(s().past.at(-1)?.label).toBe('18 Ladepunkte importiert');
    expect(p().chargePoints.map((c) => c.label)).not.toContain('LP15');
    expect(p().chargePoints.find((c) => c.label === 'LP11')).toMatchObject({
      network: { ip: '192.168.10.101', port: 502 },
      phaseRotation: 'L2-L3-L1',
      minA: 6,
      maxA: 16,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    const ids = onImported.mock.calls[0]?.[0] as string[];
    expect(ids).toHaveLength(18);
    expect(useEditorStore.getState().selectedIds).toEqual(ids);

    s().undo();
    expect(p().chargePoints).toHaveLength(3);
    expect(JSON.stringify({ ...p(), updatedAt: '' })).toBe(before);
  });

  it('Pflichtfeld ohne Zuordnung sperrt „Weiter“, bis es zugeordnet ist', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.upload(
      screen.getByLabelText('CSV-Datei wählen'),
      csvFile('Name,Adresse,Gruppe,Modell-ID\nLP10,192.168.10.50,Mieter,test/wallbox@1\n'),
    );
    await screen.findByText(/Trennzeichen Komma/);
    expect(
      screen.getByText('Pflichtfeld IP-Adresse ist keiner Spalte zugeordnet'),
    ).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Weiter zur Vorschau' });
    expect(next).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('IP-Adresse *'), 'Spalte 2: Adresse');
    expect(next).toBeEnabled();
    // Doppelbelegung wird gemeldet
    await user.selectOptions(screen.getByLabelText('Notizen'), 'Spalte 2: Adresse');
    expect(screen.getByText(/ist mehreren Feldern zugeordnet/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Notizen'), '– nicht importieren –');

    await user.click(next);
    expect(screen.getByRole('status')).toHaveTextContent('1 Zeile geprüft: 1 fehlerfrei');
    await user.click(screen.getByRole('button', { name: 'Zurück zur Zuordnung' }));
    await user.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(screen.getByLabelText('CSV-Datei wählen')).toBeInTheDocument();
  });

  it('nur fehlerhafte Zeilen: Import gesperrt, Abbrechen ändert nichts', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.upload(
      screen.getByLabelText('CSV-Datei wählen'),
      csvFile('Bezeichnung;Gruppe;IP\nLP01;Mieter;192.168.10.21\n;;\n'),
    );
    await user.click(await screen.findByRole('button', { name: 'Weiter zur Vorschau' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 Zeile geprüft: 0 fehlerfrei, 1 mit Fehlern – werden nicht importiert. 1 Leerzeile übersprungen.',
    );
    expect(screen.getByRole('button', { name: '0 fehlerfreie Zeilen importieren' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onClose).toHaveBeenCalled();
    expect(s().past).toHaveLength(0);
  });

  it('Hinweis-Zeilen sind importierbar', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.upload(
      screen.getByLabelText('CSV-Datei wählen'),
      csvFile('Bezeichnung;Gruppe;Modell-ID;IP\nLP10;Mieter;test/wallbox@1;192.168.10.50\n'),
    );
    await user.click(await screen.findByRole('button', { name: 'Weiter zur Vorschau' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 fehlerfrei (davon 1 mit Hinweis)');
    expect(
      screen.getByText(/Hinweis: Zeile 2: Fehlt in der Datei: Absicherung, Mindeststrom/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1 fehlerfreie Zeile importieren' }));
    expect(s().past.at(-1)?.label).toBe('1 Ladepunkt importiert');
    // Fehlende Angaben bleiben am Ladepunkt vermerkt, bis sie nachgetragen sind
    expect(p().chargePoints.find((c) => c.label === 'LP10')?.missingFields).toHaveLength(6);
  });

  it('meldet kaputte Anführungszeichen und leere Dateien', async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText('CSV-Datei wählen');
    await user.upload(input, csvFile('Bezeichnung;IP\n"LP01;1.2.3.4\n'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Zeile 2: Anführungszeichen wird nicht geschlossen',
    );
    await user.upload(input, csvFile('Bezeichnung;IP\r\n'));
    expect(await screen.findByText(/nur eine Kopfzeile/)).toBeInTheDocument();
  });

  it('nimmt Dateien per Drag & Drop an', async () => {
    renderDialog();
    const zone = screen.getByTestId('csv-drop-zone');
    fireEvent.dragOver(zone);
    expect(zone).toHaveClass('is-over');
    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass('is-over');
    fireEvent.drop(zone, {
      dataTransfer: { files: [csvFile('Bezeichnung\tGruppe\tIP\nLP10\tMieter\t192.168.10.50')] },
    });
    expect(await screen.findByText(/Trennzeichen Tabulator/)).toBeInTheDocument();
  });

  it('Vorlage wird lokal als Datei erzeugt', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:vorlage';
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Vorlage herunterladen' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs[0]?.type).toBe('text/csv;charset=utf-8');
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('ladepunkte-vorlage.csv');
    expect(anchor.href).toBe('blob:vorlage');
  });

  it('Escape und „Schließen“ schließen den Dialog; geschlossen wird nichts gerendert', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onClose).toHaveBeenCalledTimes(3);

    const { container } = render(<CsvImportDialog open={false} onClose={onClose} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Fokus liegt auf der Überschrift und kehrt beim Schließen zurück', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<CsvImportDialog open onClose={vi.fn()} catalog={catalog} />);
    expect(screen.getByRole('heading', { name: 'Ladepunkte aus CSV importieren' })).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('ohne geöffnetes Projekt erscheint ein Hinweis', () => {
    s().close();
    renderDialog();
    expect(screen.getByText('Kein Projekt geöffnet')).toBeInTheDocument();
  });
});

describe('decodeCsvBytes', () => {
  it('UTF-8 und Windows-1252 (deutsches Excel)', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('Gäste'))).toEqual({
      text: 'Gäste',
      encoding: 'UTF-8',
    });
    expect(decodeCsvBytes(new Uint8Array([0x47, 0xe4, 0x73, 0x74, 0x65]))).toEqual({
      text: 'Gäste',
      encoding: 'Windows-1252',
    });
  });
});
