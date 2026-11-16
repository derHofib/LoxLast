import { type Finding } from '@lastplan/core';
import { Button } from '@lastplan/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChecksStore } from '../../state/checksStore';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { createChargePoint, createCluster, createGroup, type CreateAction } from './actions';
import { StructureContext, type StructureContextValue } from './context';
import { computeLayout, layoutKey, type LayoutResult } from './layout';
import { Sidebar } from './Sidebar';
import { StructureCanvas } from './StructureCanvas';
import { buildTree } from './tree';
import { useStructureShortcuts } from './useStructureShortcuts';
import './structure.css';

/** Struktur-Ansicht (Kap. 11.1): Arbeitsfläche „Lastverteilung“ links, Seitenleiste rechts. */
export function StructureView() {
  const project = useProjectStore((s) => s.project);
  const result = useChecksStore((s) => s.result);
  const clipboard = useEditorStore((s) => s.clipboard);
  const [status, setStatus] = useState('');
  const announce = useCallback((m: string) => setStatus(m), []);
  useStructureShortcuts(announce);

  const findingsByTarget = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of result?.findings ?? []) {
      for (const id of f.targetIds) map.set(id, [...(map.get(id) ?? []), f]);
    }
    return map;
  }, [result]);

  const tree = useMemo(() => (project ? buildTree(project) : null), [project]);

  // Meldungszeilen vergrößern den Kopf der Karte – nur dann ist ein neues Layout nötig.
  const flagged = useMemo(() => {
    const set = new Set<string>();
    if (tree)
      for (const [id, item] of tree.items) {
        if (item.kind !== 'chargePoint' && findingsByTarget.has(id)) set.add(id);
      }
    return set;
  }, [tree, findingsByTarget]);

  const key = project ? layoutKey(project, { flagged }) : '';
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void computeLayout(project, { flagged }).then((l) => {
      if (!cancelled) setLayout(l);
    });
    return () => {
      cancelled = true;
    };
    // Neu berechnen, wenn sich nur die Struktur ändert (key), nicht bei Zahlenänderungen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const context = useMemo<StructureContextValue>(
    () => ({ findingsByTarget, analysis: result?.analysis ?? null, announce }),
    [findingsByTarget, result, announce],
  );

  if (!project || !tree) return null;

  /** Legt ein Element an und wählt es aus; die Auswahl zum Zeitpunkt des Klicks bestimmt das Elternelement. */
  const add = (make: (selectedId: string | undefined) => CreateAction) => {
    const action = make(useEditorStore.getState().selectedIds[0]);
    useProjectStore.getState().execute(action.command);
    useEditorStore.getState().select([action.id]);
    announce(action.message);
  };

  return (
    <StructureContext.Provider value={context}>
      <div className="structure">
        <section className="structure__work" aria-labelledby="structure-title">
          <header className="structure__head">
            <h2 id="structure-title" className="structure__title">
              Lastverteilung
            </h2>
            <div className="structure__actions">
              <Button onClick={() => add(() => createCluster())}>+ Cluster</Button>
              <Button onClick={() => add((sel) => createGroup(project, sel))}>+ Gruppe</Button>
              <Button onClick={() => add((sel) => createChargePoint(project, sel))}>
                + Ladepunkt
              </Button>
            </div>
          </header>
          {clipboard ? (
            <p className="structure__clip" role="status">
              {clipboard.ids.length} {clipboard.ids.length === 1 ? 'Element' : 'Elemente'}{' '}
              ausgeschnitten – Ziel wählen und Strg+V drücken, Escape bricht ab.
            </p>
          ) : null}
          {project.clusters.length === 0 ? (
            <p className="structure__empty">
              Noch keine Anlagenstruktur. Mit „+ Cluster“ beginnen, danach „+ Gruppe“ und „+
              Ladepunkt“ (Kürzel N) – oder gleich „+ Ladepunkt“, die fehlenden Ebenen entstehen
              automatisch.
            </p>
          ) : null}
          {layout ? (
            <StructureCanvas layout={layout} tree={tree} />
          ) : (
            <p className="structure__empty">Layout wird berechnet …</p>
          )}
          <p className="lp-visually-hidden" role="status" aria-live="polite">
            {status}
          </p>
        </section>
        <div className="structure__side">
          <Sidebar />
        </div>
      </div>
    </StructureContext.Provider>
  );
}
