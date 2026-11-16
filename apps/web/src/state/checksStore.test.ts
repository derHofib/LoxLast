import { catalogFromModels, createProject } from '@lastplan/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../test-fixtures';
import { useChecksStore, startChecks } from './checksStore';
import { updateChargePointsCommand } from './commands';
import { useEditorStore } from './editorStore';
import { resetToBundledLibrary, useLibraryStore } from '../library/libraryStore';
import { bundledCatalog } from '../library/catalog';
import { useProjectStore } from './projectStore';

const testCatalog = catalogFromModels([
  {
    id: 'test/wallbox@1',
    displayName: 'Testwallbox',
    complete: true,
    missingFields: [],
    electrical: { minA: 6, maxA: 32, phases: [1, 3], phaseSwitching: false },
  },
]);

let stop: () => void = () => undefined;
beforeEach(() => {
  vi.useFakeTimers();
  useProjectStore.getState().close();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

const ruleIds = () => useChecksStore.getState().result?.findings.map((f) => f.ruleId);

describe('Prüfung im Store', () => {
  it('prüft beim Öffnen sofort und nach Änderungen entprellt', () => {
    stop = startChecks(testCatalog, 100);
    expect(useChecksStore.getState().result).toBeNull();

    const project = sampleProject();
    useProjectStore.getState().open(project);
    expect(ruleIds()).toEqual(['UNBALANCE', 'METER_MISSING']);

    useProjectStore
      .getState()
      .execute(updateChargePointsCommand([project.chargePoints[0]!.id], { minA: 4 }));
    expect(useChecksStore.getState().pending).toBe(true);
    expect(ruleIds()).toEqual(['UNBALANCE', 'METER_MISSING']);
    vi.advanceTimersByTime(100);
    expect(useChecksStore.getState().pending).toBe(false);
    expect(ruleIds()?.[0]).toBe('CP_MIN_MAX');
  });

  it('räumt die Auswahl auf, wenn Elemente verschwinden', () => {
    stop = startChecks(testCatalog, 0);
    const project = sampleProject();
    useProjectStore.getState().open(project);
    useEditorStore.getState().select([project.chargePoints[0]!.id]);
    useProjectStore.getState().open(createProject({ name: 'Leer' }));
    expect(useEditorStore.getState().selectedIds).toEqual([]);
    expect(useChecksStore.getState().result?.severity).toBe('warning'); // nur METER_MISSING
  });

  it('Standard-Katalog ist die mitgelieferte Bibliothek; Stopp beendet laufende Prüfung', () => {
    useProjectStore.getState().open(sampleProject());
    stop = startChecks();
    expect(ruleIds()).toContain('MODEL_INCOMPLETE'); // Testmodell ist nicht in der echten Bibliothek
    useProjectStore.getState().execute(
      updateChargePointsCommand([useProjectStore.getState().project!.chargePoints[0]!.id], {
        minA: 4,
      }),
    );
    stop();
    vi.advanceTimersByTime(1000);
    expect(useChecksStore.getState().pending).toBe(true);
  });

  it('prüft mit dem neuen Katalog neu, sobald die Bibliothek wechselt', () => {
    try {
      useProjectStore.getState().open(sampleProject());
      stop = startChecks();
      expect(ruleIds()).toContain('MODEL_INCOMPLETE');

      useLibraryStore.setState({ source: 'nachgeladen', version: 'x', catalog: testCatalog });
      expect(ruleIds()).not.toContain('MODEL_INCOMPLETE');
    } finally {
      resetToBundledLibrary();
      expect(useLibraryStore.getState().catalog).toBe(bundledCatalog);
    }
  });
});
