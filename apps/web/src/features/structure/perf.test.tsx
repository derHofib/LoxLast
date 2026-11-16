import '@testing-library/jest-dom/vitest';
import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeLargeProject } from '../../../../../packages/core/src/__tests__/arbitraries';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { renderStructure, type Rendered } from './testing';

let view: Rendered | undefined;
afterEach(() => {
  view?.stopChecks();
  view = undefined;
  useProjectStore.getState().close();
});

/**
 * Leistungstest (Kap. 13: 200 Ladepunkte flüssig). Gemessen wird in jsdom, also ohne Browser-Layout:
 * Zeit von der Montage bis alle 200 Ladepunkte als Buttons stehen (Layout mit elkjs + React-Flow-Knoten).
 * Die Schranke ist bewusst großzügig; im Bericht steht der gemessene Wert.
 */
describe('Leistung bei 200 Ladepunkten', () => {
  it('Ansicht erscheint in unter 1 s und lässt sich schnell auswählen', async () => {
    const project = makeLargeProject(200);
    const start = performance.now();
    view = renderStructure(project);
    // Billige DOM-Abfrage statt findByRole: Rollen-/Namensberechnung für 240 Buttons würde die Messung dominieren
    const count = () => document.querySelectorAll('[data-structure-id]').length;
    await waitFor(() => expect(count()).toBe(1 + 10 + 30 + 200), { timeout: 5000, interval: 10 });
    const renderMs = performance.now() - start;
    console.info(`[Leistung] 200 Ladepunkte: Layout und Render ${Math.round(renderMs)} ms`);
    expect(renderMs).toBeLessThan(1000);

    // Auswahl wechseln: alle 240 Knoten prüfen ihren Zustand, aber nur zwei zeichnen neu
    const t = performance.now();
    act(() => useEditorStore.getState().select([project.chargePoints[100]!.id]));
    const selectMs = performance.now() - t;
    console.info(`[Leistung] Auswahl wechseln: ${Math.round(selectMs)} ms`);
    expect(selectMs).toBeLessThan(250);
  });
});
