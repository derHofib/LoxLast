import type { Project } from '@lastplan/core';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { startChecks, useChecksStore } from '../../state/checksStore';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { StructureView } from './StructureView';
import { useDndStore } from './dndStore';

/** Hilfen für die Komponententests der Struktur-Ansicht (jsdom hat kein Layout und kein ResizeObserver). */

export function installDomShims(): void {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  class Matrix {
    m22: number;
    constructor(transform?: string) {
      const scale = /scale\(([\d.]+)\)/.exec(transform ?? '');
      this.m22 = scale ? Number(scale[1]) : 1;
    }
  }
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = Matrix;
}

export interface Rendered extends ReturnType<typeof render> {
  stopChecks: () => void;
}

/** Öffnet das Projekt, startet die Prüfung ohne Entprellung und rendert die Ansicht. */
export function renderStructure(project: Project): Rendered {
  installDomShims();
  useEditorStore.setState({ selectedIds: [], reveal: null, clipboard: null });
  useDndStore.getState().end();
  useProjectStore.getState().open(project);
  const stopChecks = startChecks(undefined, 0);
  const view = render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <StructureView />
    </MemoryRouter>,
  );
  return {
    ...view,
    stopChecks: () => {
      stopChecks();
      useChecksStore.setState({ result: null, pending: false });
    },
  };
}
