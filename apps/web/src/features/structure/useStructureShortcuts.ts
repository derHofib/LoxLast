import { useEffect } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { isEditableTarget } from '../../state/useShortcuts';
import { createChargePoint } from './actions';
import { canDrop, dropCommand, kindOf, pasteTarget, payloadFromSelection } from './dropRules';

/**
 * Kürzel der Struktur-Ansicht: Strg+X Ausschneiden, Strg+V Einfügen in das ausgewählte Ziel
 * (Tastatur-Alternative zu Drag & Drop, Kap. 10.3) und N = neuer Ladepunkt in der Gruppe der Auswahl.
 * Undo/Redo/Entf/Strg+D liegen global in useShortcuts.
 */
export function useStructureShortcuts(announce: (message: string) => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey || isEditableTarget(e.target)) return;
      const { project, execute } = useProjectStore.getState();
      if (!project) return;
      const editor = useEditorStore.getState();
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && key === 'x') {
        const payload = payloadFromSelection(project, editor.selectedIds);
        if (!payload) return;
        editor.cut(payload.ids);
        announce(
          payload.ids.length === 1
            ? 'Ausgeschnitten. Ziel auswählen und Strg+V drücken.'
            : `${payload.ids.length} Elemente ausgeschnitten. Ziel auswählen und Strg+V drücken.`,
        );
      } else if (mod && key === 'v') {
        const clip = editor.clipboard;
        if (!clip) return;
        const payload = payloadFromSelection(project, clip.ids);
        if (!payload) return;
        const targetId = pasteTarget(project, payload.kind, editor.selectedIds[0]);
        const check = targetId === undefined ? undefined : canDrop(project, payload, targetId);
        if (targetId === undefined || !check?.ok) {
          announce(
            check && !check.ok
              ? check.reason
              : 'Kein passendes Ziel ausgewählt. Gruppe, Cluster oder Netzanschluss wählen.',
          );
        } else {
          const cmd = dropCommand(project, payload, targetId);
          if (cmd) {
            execute(cmd);
            editor.select(payload.ids);
            editor.clearClipboard();
            announce(`${cmd.label}: eingefügt`);
          }
        }
      } else if (!mod && !e.shiftKey && key === 'n') {
        const first = editor.selectedIds[0];
        const action = createChargePoint(
          project,
          first !== undefined && kindOf(project, first) ? first : undefined,
        );
        execute(action.command);
        editor.select([action.id]);
        announce(action.message);
      } else if (e.key === 'Escape' && editor.clipboard) {
        editor.clearClipboard();
        announce('Ausschneiden abgebrochen');
        return;
      } else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [announce]);
}
