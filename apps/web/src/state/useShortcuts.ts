import { useEffect } from 'react';
import { useProjectStore } from './projectStore';

/** Tastaturkürzel-Rahmen (Kap. 10.3). Eingabefelder behalten ihr eigenes Undo. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export function useShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const { undo, redo } = useProjectStore.getState();
      if (key === 'z' && !e.shiftKey) undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') redo();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
