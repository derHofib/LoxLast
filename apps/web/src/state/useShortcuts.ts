import { useEffect } from 'react';
import { deleteCommand, duplicateCommand } from './commands';
import { useEditorStore } from './editorStore';
import { useProjectStore } from './projectStore';

/** Tastaturkürzel-Rahmen (Kap. 10.3). Eingabefelder behalten ihr eigenes Undo. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/** Auswahl ohne den Netzanschluss ('site'), der nicht gelöscht oder dupliziert werden kann. */
const editableSelection = () => useEditorStore.getState().selectedIds.filter((id) => id !== 'site');

/**
 * Globale Kürzel: Strg+Z / Strg+Y (Strg+Umschalt+Z) Undo/Redo, Strg+D duplizieren,
 * Entf löschen (mit Undo statt Rückfrage). Ansichtsspezifische Kürzel (N, /, Pfeiltasten)
 * registrieren die Ansichten selbst.
 */
export function useShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey || isEditableTarget(e.target)) return;
      const { project, undo, redo, execute } = useProjectStore.getState();
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && key === 'z' && !e.shiftKey) undo();
      else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) redo();
      else if (mod && key === 'd') {
        const ids = editableSelection();
        if (!project || ids.length === 0) return;
        const { command, created } = duplicateCommand(project, ids);
        execute(command);
        useEditorStore.getState().select(created);
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        const ids = editableSelection();
        if (!project || ids.length === 0) return;
        execute(deleteCommand(project, ids));
      } else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
