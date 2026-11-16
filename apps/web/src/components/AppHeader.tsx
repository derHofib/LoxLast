import { Button } from '@lastplan/ui';
import { Link } from 'react-router-dom';
import { useProjectStore } from '../state/projectStore';
import type { SaveStatus } from '../storage/autosave';
import { ThemeSwitch } from '../theme/ThemeSwitch';

const STATUS_TEXT: Record<SaveStatus | 'pending', string> = {
  saved: 'Gespeichert',
  pending: 'Ungespeicherte Änderungen',
  saving: 'Speichert …',
  error: 'Speichern fehlgeschlagen',
};

export function AppHeader({ saveStatus }: { saveStatus?: SaveStatus | undefined }) {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const past = useProjectStore((s) => s.past);
  const future = useProjectStore((s) => s.future);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const status: SaveStatus | 'pending' =
    saveStatus === 'error' || saveStatus === 'saving' ? saveStatus : dirty ? 'pending' : 'saved';
  const lastUndo = past[past.length - 1]?.label;
  const lastRedo = future[0]?.label;

  return (
    <header className="app-header">
      <Link to="/" className="app-brand" aria-label="LastPlan – zur Projektübersicht">
        <span className="app-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9 1 3 9h4l-1 6 6-8H8l1-6z" />
          </svg>
        </span>
        <span className="app-title">LastPlan</span>
      </Link>
      {project ? (
        <span className="app-project" title={project.name}>
          {project.name}
        </span>
      ) : null}
      <div className="app-header__tools">
        {project ? (
          <>
            <span className="app-save" role="status" data-status={status}>
              {STATUS_TEXT[status]}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={undo}
              disabled={!lastUndo}
              title={lastUndo ? `Rückgängig: ${lastUndo} (Strg+Z)` : 'Nichts zum Rückgängigmachen'}
            >
              Rückgängig
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={redo}
              disabled={!lastRedo}
              title={
                lastRedo ? `Wiederholen: ${lastRedo} (Strg+Umschalt+Z)` : 'Nichts zu wiederholen'
              }
            >
              Wiederholen
            </Button>
          </>
        ) : null}
        <ThemeSwitch />
      </div>
    </header>
  );
}
