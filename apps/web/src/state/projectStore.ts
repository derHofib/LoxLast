import { create } from 'zustand';
import type { Project } from '@lastplan/core';
import {
  MAX_HISTORY,
  redoEntry,
  runCommand,
  undoEntry,
  type Command,
  type HistoryEntry,
} from './history';

export interface ProjectState {
  project: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Seit dem letzten erfolgreichen Speichern geändert. */
  dirty: boolean;
  open: (project: Project) => void;
  close: () => void;
  execute: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
}

const touch = (p: Project): Project => ({ ...p, updatedAt: new Date().toISOString() });

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  dirty: false,
  open: (project) => set({ project, past: [], future: [], dirty: false }),
  close: () => set({ project: null, past: [], future: [], dirty: false }),
  execute: (cmd) => {
    const { project, past } = get();
    if (!project) return;
    const result = runCommand(project, cmd);
    if (!result) return;
    set({
      project: touch(result.project),
      past: [...past, result.entry].slice(-MAX_HISTORY),
      future: [],
      dirty: true,
    });
  },
  undo: () => {
    const { project, past, future } = get();
    const entry = past[past.length - 1];
    if (!project || !entry) return;
    set({
      project: touch(undoEntry(project, entry)),
      past: past.slice(0, -1),
      future: [entry, ...future],
      dirty: true,
    });
  },
  redo: () => {
    const { project, past, future } = get();
    const entry = future[0];
    if (!project || !entry) return;
    set({
      project: touch(redoEntry(project, entry)),
      past: [...past, entry],
      future: future.slice(1),
      dirty: true,
    });
  },
  markSaved: () => set({ dirty: false }),
}));
