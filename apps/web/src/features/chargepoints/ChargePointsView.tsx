import { addCluster, addGroup, newId } from '@lastplan/core';
import { Button, Card } from '@lastplan/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { bundledLibrary } from '../../library/catalog';
import { addChargePointCommand } from '../../state/commands';
import { useChecksStore } from '../../state/checksStore';
import { useEditorStore } from '../../state/editorStore';
import { command } from '../../state/history';
import { useProjectStore } from '../../state/projectStore';
import { isEditableTarget } from '../../state/useShortcuts';
import type { LibraryCheck } from '@lastplan/wallbox-library';
import { ChargePointForm } from './ChargePointForm';
import { ChargePointInfo } from './ChargePointInfo';
import { ChargePointList, matchesSearch } from './ChargePointList';
import { createLibraryIndex } from './libraryInfo';
import './chargepoints.css';

export interface ChargePointsViewProps {
  /** Wallbox-Bibliothek; Standard: die mitgelieferte. */
  library?: LibraryCheck;
  /** Einhängepunkt für den CSV-Import (eigene Komponente); ohne Angabe ist der Button deaktiviert. */
  onCsvImport?: () => void;
}

/**
 * Ladepunkte-Ansicht (Kap. 11.2): Liste | Eigenschaften | Infos.
 * Auswahl liegt im editorStore, damit ein Sprung aus der Struktur-Ansicht hier landet.
 * Kürzel: `/` fokussiert die Suche, `N` legt einen Ladepunkt in der Gruppe des gewählten an.
 */
export function ChargePointsView({ library = bundledLibrary, onCsvImport }: ChargePointsViewProps) {
  const project = useProjectStore((s) => s.project);
  const execute = useProjectStore((s) => s.execute);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const select = useEditorStore((s) => s.select);
  const reveal = useEditorStore((s) => s.reveal);
  const checks = useChecksStore((s) => s.result);
  const pending = useChecksStore((s) => s.pending);
  const index = useMemo(() => createLibraryIndex(library), [library]);
  const [search, setSearch] = useState('');
  const [focusNonce, setFocusNonce] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const cps = useMemo(
    () => (project?.chargePoints ?? []).filter((cp) => selectedIds.includes(cp.id)),
    [project, selectedIds],
  );
  const firstId = project?.chargePoints[0]?.id;

  // Ohne Ladepunkt in der Auswahl den ersten wählen (z. B. nach Wechsel aus der Struktur-Ansicht)
  useEffect(() => {
    if (cps.length === 0 && firstId) select([firstId]);
  }, [cps.length, firstId, select]);

  // Sprung aus einer Prüfmeldung: Eintrag sichtbar machen
  useEffect(() => {
    if (!reveal) return;
    setSearch('');
    root.current
      ?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [reveal]);

  const addDirect = () => {
    if (!project) return;
    const groupId = cps[0]?.groupId ?? project.groups[0]?.id;
    if (!groupId) return;
    const created = addChargePointCommand({
      groupId,
      // Ohne Vorlage-Ladepunkt braucht der neue ein Modell aus der Bibliothek
      ...(project.chargePoints.length === 0 && index.models[0]
        ? { libraryModelId: index.models[0].expectedId }
        : {}),
    });
    execute(created.command);
    select([created.id]);
    setSearch('');
    setFocusNonce((n) => n + 1);
  };
  const addRef = useRef(addDirect);
  addRef.current = addDirect;

  // Ansichtslokale Kürzel; in Eingabefeldern bleiben sie wirkungslos
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (e.key === '/') {
        const input = root.current?.querySelector<HTMLInputElement>('input[type="search"]');
        if (!input) return;
        e.preventDefault();
        input.focus();
        input.select();
      } else if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault();
        addRef.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!project) return null;

  if (project.groups.length === 0) {
    return (
      <Card title="Ladepunkte">
        <p>
          Es gibt noch keine Gruppe. Ladepunkte gehören immer zu einer Gruppe in einem Cluster
          (Unterverteilung).
        </p>
        <Button
          variant="primary"
          onClick={() => {
            const clusterId = newId();
            execute(
              command('Cluster und Gruppe anlegen', (d) => {
                addCluster(d, { id: clusterId });
                addGroup(d, { id: newId(), clusterId });
              }),
            );
          }}
        >
          Cluster und Gruppe anlegen
        </Button>
      </Card>
    );
  }

  const visible = project.chargePoints.filter((cp) => matchesSearch(project, index, cp, search));

  const goNext = (): boolean => {
    const last = cps.at(-1);
    const pos = visible.findIndex((cp) => cp.id === last?.id);
    const next = visible[pos + 1];
    if (!next) return false;
    select([next.id]);
    setFocusNonce((n) => n + 1);
    return true;
  };

  return (
    <div ref={root} className="cp-view">
      <ChargePointList
        project={project}
        index={index}
        selectedIds={selectedIds}
        search={search}
        onSearch={setSearch}
        onSelect={select}
        onAdd={addDirect}
        onCsvImport={onCsvImport}
        canAdd
      />
      {cps.length === 0 ? (
        <section className="cp-empty" aria-label="Eigenschaften">
          <p>Noch kein Ladepunkt. Mit „+ Ladepunkt“ oder der Taste N den ersten anlegen.</p>
        </section>
      ) : (
        <ChargePointForm
          key={cps.map((c) => c.id).join(',')}
          project={project}
          cps={cps}
          index={index}
          onNext={goNext}
          focusNonce={focusNonce}
        />
      )}
      <ChargePointInfo
        cps={cps}
        index={index}
        findings={checks?.findings ?? []}
        pending={pending}
      />
    </div>
  );
}
