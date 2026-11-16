import { structureHash } from '@lastplan/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../../state/projectStore';
import { sampleProject } from '../../test-fixtures';
import { lastExport, recordExportCommand, structureChangedSinceExport } from './record';

const store = () => useProjectStore.getState();

beforeEach(() => {
  store().close();
  store().open(sampleProject());
});

describe('ExportRecord', () => {
  it('hängt einen Eintrag mit Modus, Zeit, Hash und Config-Version an und ist per Undo rückgängig', () => {
    const p = store().project!;
    expect(lastExport(p)).toBeUndefined();
    store().execute(
      recordExportCommand(p, {
        mode: 'templates',
        configVersion: '14.8',
        now: new Date('2026-01-02T03:04:05.000Z'),
        id: 'rec1',
      }),
    );
    const rec = lastExport(store().project!)!;
    expect(rec).toMatchObject({
      id: 'rec1',
      mode: 'templates',
      createdAt: '2026-01-02T03:04:05.000Z',
      configVersion: '14.8',
      structureHash: structureHash(p),
    });
    store().undo();
    expect(store().project!.exportHistory).toEqual([]);
  });

  it('lässt die Config-Version weg, wenn keine bekannt ist', () => {
    store().execute(recordExportCommand(store().project!, { mode: 'project' }));
    expect(lastExport(store().project!)).not.toHaveProperty('configVersion');
  });

  it('erkennt Strukturänderungen seit dem letzten Export, nicht aber Stellgrößen', () => {
    expect(structureChangedSinceExport(store().project!)).toBe(false);
    store().execute(recordExportCommand(store().project!, { mode: 'templates' }));
    expect(structureChangedSinceExport(store().project!)).toBe(false);
    store().execute({
      label: 'Limit',
      recipe: (d) => {
        d.clusters[0]!.limitA = 99;
      },
    });
    expect(structureChangedSinceExport(store().project!)).toBe(false);
    store().execute({
      label: 'Umbenennen',
      recipe: (d) => {
        d.chargePoints[0]!.label = 'Neu';
      },
    });
    expect(structureChangedSinceExport(store().project!)).toBe(true);
  });
});
