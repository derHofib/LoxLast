import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { Project } from '@lastplan/core';

enablePatches();

/**
 * Befehl (Command-Pattern, Kap. 2.3): beschreibt eine Änderung am Projekt als Immer-Rezept.
 * Undo/Redo laufen über die von Immer erzeugten Patches, einzelne Befehle müssen daher
 * keine eigene Umkehrlogik mitbringen.
 */
export interface Command {
  /** Beschriftung für Undo/Redo, z. B. „Ladepunkt LP01 umbenennen“. */
  label: string;
  recipe: (draft: Project) => void;
}

export function command(label: string, recipe: (draft: Project) => void): Command {
  return { label, recipe };
}

/** Sammelbefehl: mehrere Änderungen = ein Undo-Schritt (Massenbearbeitung, Kap. 10.3). */
export function batch(label: string, commands: readonly Command[]): Command {
  return {
    label,
    recipe: (draft) => {
      for (const c of commands) c.recipe(draft);
    },
  };
}

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

export const MAX_HISTORY = 200;

/** Wendet einen Befehl an. Liefert null, wenn er nichts geändert hat (kein Undo-Eintrag). */
export function runCommand(
  project: Project,
  cmd: Command,
): { project: Project; entry: HistoryEntry } | null {
  const [next, patches, inverse] = produceWithPatches(project, cmd.recipe);
  if (patches.length === 0) return null;
  return { project: next, entry: { label: cmd.label, patches, inverse } };
}

export const undoEntry = (project: Project, entry: HistoryEntry): Project =>
  applyPatches(project, entry.inverse);

export const redoEntry = (project: Project, entry: HistoryEntry): Project =>
  applyPatches(project, entry.patches);
