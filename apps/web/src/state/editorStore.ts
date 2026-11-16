import { create } from 'zustand';
import type { Project } from '@lastplan/core';

/**
 * Bedienzustand der Editor-Ansichten (nicht Teil des Projekts, nicht im Undo):
 * Auswahl, Sprungziel aus einer Prüfmeldung, Zwischenablage für Ausschneiden/Einfügen
 * (Tastatur-Alternative zu Drag & Drop, Kap. 10.3).
 */
export interface EditorState {
  selectedIds: string[];
  /** Wird bei jedem Sprung neu gesetzt, damit die Ansicht scrollt und fokussiert. */
  reveal: { ids: string[]; nonce: number } | null;
  clipboard: { mode: 'cut'; ids: string[] } | null;
  select: (ids: readonly string[]) => void;
  toggle: (id: string) => void;
  clearSelection: () => void;
  /** Auswählen und hinspringen (Klick auf Prüfmeldung). */
  revealIds: (ids: readonly string[]) => void;
  cut: (ids: readonly string[]) => void;
  clearClipboard: () => void;
  /** Entfernt IDs, die es im Projekt nicht mehr gibt (nach Löschen oder Undo). */
  prune: (project: Project | null) => void;
}

let nonce = 0;

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedIds: [],
  reveal: null,
  clipboard: null,
  select: (ids) => set({ selectedIds: [...new Set(ids)] }),
  toggle: (id) => {
    const { selectedIds } = get();
    set({
      selectedIds: selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id],
    });
  },
  clearSelection: () => set({ selectedIds: [] }),
  revealIds: (ids) =>
    set({ selectedIds: [...new Set(ids)], reveal: { ids: [...ids], nonce: ++nonce } }),
  cut: (ids) => set({ clipboard: ids.length > 0 ? { mode: 'cut', ids: [...ids] } : null }),
  clearClipboard: () => set({ clipboard: null }),
  prune: (project) => {
    const existing = new Set(
      project
        ? [...project.clusters, ...project.groups, ...project.chargePoints].map((e) => e.id)
        : [],
    );
    existing.add('site');
    const { selectedIds, clipboard } = get();
    const keep = (ids: string[]) => ids.filter((id) => existing.has(id));
    const nextSelected = keep(selectedIds);
    const nextClip = clipboard ? keep(clipboard.ids) : [];
    if (
      nextSelected.length === selectedIds.length &&
      nextClip.length === (clipboard?.ids.length ?? 0)
    )
      return;
    set({
      selectedIds: nextSelected,
      clipboard: clipboard && nextClip.length > 0 ? { ...clipboard, ids: nextClip } : null,
    });
  },
}));
