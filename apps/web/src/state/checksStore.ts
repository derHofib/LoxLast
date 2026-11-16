import { create } from 'zustand';
import { runChecks, type CheckResult, type ModelCatalog, type Project } from '@lastplan/core';
import { useLibraryStore } from '../library/libraryStore';
import { useEditorStore } from './editorStore';
import { useProjectStore } from './projectStore';

/**
 * Prüfung bei jeder Änderung (Kap. 5): entprellt, damit Tippen flüssig bleibt.
 * Ein Lauf dauert bei 200 Ladepunkten ca. 4 ms (ADR 0007).
 */
export const CHECK_DEBOUNCE_MS = 120;

export interface ChecksState {
  result: CheckResult | null;
  /** Projekt hat sich geändert, Ergebnis ist noch vom vorherigen Stand. */
  pending: boolean;
}

export const useChecksStore = create<ChecksState>(() => ({ result: null, pending: false }));

/**
 * Startet die Prüfung für das jeweils geöffnete Projekt. Räumt außerdem Auswahl und
 * Zwischenablage auf, wenn Elemente verschwinden. Ohne `catalog` gilt der jeweils aktuelle
 * Katalog der Bibliothek; wechselt er (Nachladen), wird neu geprüft. Rückgabe: Stopp-Funktion.
 */
export function startChecks(catalog?: ModelCatalog, debounceMs = CHECK_DEBOUNCE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Project | null = useProjectStore.getState().project;

  const run = () => {
    timer = undefined;
    const activeCatalog = catalog ?? useLibraryStore.getState().catalog;
    useChecksStore.setState({
      result: current ? runChecks(current, activeCatalog) : null,
      pending: false,
    });
  };
  run();

  const unsubscribeLibrary = catalog
    ? undefined
    : useLibraryStore.subscribe((state, previous) => {
        if (state.catalog === previous.catalog) return;
        if (timer !== undefined) clearTimeout(timer);
        run();
      });

  const unsubscribe = useProjectStore.subscribe((state) => {
    if (state.project === current) return;
    const opened = current?.id !== state.project?.id;
    current = state.project;
    useEditorStore.getState().prune(current);
    if (timer !== undefined) clearTimeout(timer);
    if (opened || debounceMs <= 0) {
      run(); // neues Projekt sofort prüfen, ohne Ergebnis des alten anzuzeigen
    } else {
      useChecksStore.setState({ pending: true });
      timer = setTimeout(run, debounceMs);
    }
  });

  return () => {
    unsubscribe();
    unsubscribeLibrary?.();
    if (timer !== undefined) clearTimeout(timer);
  };
}
