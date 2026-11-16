import { Card, Notice, Tabs, TextField } from '@lastplan/ui';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useProjectStore } from '../state/projectStore';
import { repository } from '../storage/db';
import { command } from '../state/history';
import { ChargePointsTab } from '../features/chargepoints/ChargePointsTab';

export const PROJECT_TABS = [
  { id: 'struktur', label: 'Struktur' },
  { id: 'ladepunkte', label: 'Ladepunkte' },
  { id: 'export', label: 'Export' },
  { id: 'live', label: 'Live' },
] as const;

const PLACEHOLDER: Record<string, string> = {
  struktur: 'Struktur-Ansicht folgt in Meilenstein 4.',
  ladepunkte: 'Ladepunkt-Tabelle folgt in Meilenstein 4.',
  export: 'Loxone-Export folgt in Meilenstein 6.',
  live: 'Live-Werte folgen in Meilenstein 8 (benötigt das Gateway).',
};

/** Rahmen eines geöffneten Projekts: lädt es aus IndexedDB, zeigt Tabs und Inhalt. */
export function ProjectShell() {
  const { id = '', tab = 'struktur' } = useParams();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project);
  const open = useProjectStore((s) => s.open);
  const close = useProjectStore((s) => s.close);
  const execute = useProjectStore((s) => s.execute);
  const [state, setState] = useState<'loading' | 'missing' | { error: string } | 'ready'>(
    'loading',
  );

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    repository
      .get(id)
      .then((p) => {
        if (cancelled) return;
        if (!p) return setState('missing');
        open(p);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
      close();
    };
  }, [id, open, close]);

  if (state === 'loading') return <main className="app-main">Lädt …</main>;
  if (state === 'missing' || typeof state === 'object') {
    return (
      <main className="app-main">
        <Notice
          kind="error"
          title={state === 'missing' ? 'Projekt nicht gefunden' : 'Projekt lässt sich nicht laden'}
          solution={
            state === 'missing'
              ? 'In der Projektübersicht ein vorhandenes Projekt wählen oder eine exportierte Datei importieren.'
              : 'Projekt aus einer Sicherung (JSON-Export) importieren.'
          }
        >
          {typeof state === 'object' ? state.error : null}
        </Notice>
        <p>
          <Link to="/">Zur Projektübersicht</Link>
        </p>
      </main>
    );
  }
  if (!PROJECT_TABS.some((t) => t.id === tab))
    return <Navigate to={`/projekt/${id}/struktur`} replace />;
  if (!project) return null;

  return (
    <main className="app-main">
      <Tabs
        label="Projektbereiche"
        tabs={PROJECT_TABS}
        value={tab}
        onChange={(t) => navigate(`/projekt/${id}/${t}`)}
      >
        <div className="app-stack">
          {tab === 'struktur' ? (
            <Card title="Projekt">
              <TextField
                key={project.name}
                label="Projektname"
                defaultValue={project.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== project.name) {
                    execute(
                      command('Projekt umbenennen', (d) => {
                        d.name = name;
                      }),
                    );
                  } else {
                    e.target.value = project.name;
                  }
                }}
              />
            </Card>
          ) : null}
          {tab === 'ladepunkte' ? <ChargePointsTab /> : <Card>{PLACEHOLDER[tab]}</Card>}
        </div>
      </Tabs>
    </main>
  );
}
