import { create } from 'zustand';
import type { DragPayload } from './dropRules';

/** Laufender Drag-Vorgang (nur Bedienzustand, nicht im Projekt und nicht im Undo). */
interface DndState {
  drag: DragPayload | null;
  over: string | null;
  start: (payload: DragPayload) => void;
  setOver: (id: string | null) => void;
  end: () => void;
}

export const useDndStore = create<DndState>((set) => ({
  drag: null,
  over: null,
  start: (drag) => set({ drag, over: null }),
  setOver: (over) => set({ over }),
  end: () => set({ drag: null, over: null }),
}));
