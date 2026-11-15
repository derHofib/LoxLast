import type { Project } from '@lastplan/core';
import { useProjectStore } from '../state/projectStore';

export interface Saver {
  save(project: Project): Promise<void>;
}

export type SaveStatus = 'saved' | 'saving' | 'error';

/**
 * Speichert Änderungen verzögert (Entprellung). Meldet den Zustand zurück,
 * damit die Kopfzeile „Gespeichert“ bzw. einen Fehler mit Ausweg zeigen kann.
 */
export function startAutosave(
  saver: Saver,
  onStatus: (s: SaveStatus, error?: string) => void,
  delayMs = 600,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    timer = undefined;
    const { project, dirty, markSaved } = useProjectStore.getState();
    if (!project || !dirty) return;
    onStatus('saving');
    try {
      await saver.save(project);
      // Nur als gespeichert markieren, wenn zwischenzeitlich nichts Neues kam
      if (useProjectStore.getState().project === project) markSaved();
      onStatus('saved');
    } catch (e) {
      onStatus('error', e instanceof Error ? e.message : String(e));
    }
  };

  const unsubscribe = useProjectStore.subscribe((state, prev) => {
    if (state.project !== prev.project && state.dirty) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    }
  });

  // Beim Verlassen der Seite sofort schreiben (best effort), damit die Entprellung nichts verschluckt
  const onHide = () => {
    if (timer) {
      clearTimeout(timer);
      void flush();
    }
  };
  window.addEventListener('pagehide', onHide);

  return () => {
    window.removeEventListener('pagehide', onHide);
    unsubscribe();
    if (timer) {
      clearTimeout(timer);
      void flush(); // beim Schließen nichts verlieren
    }
  };
}
