import {
  formatA,
  gridPhaseOf,
  maxPhase,
  minPhase,
  SITE_LEVEL_ID,
  type Finding,
} from '@lastplan/core';
import {
  ChargePointChip,
  ClusterNode,
  GridNode,
  GroupNode,
  ProgressBar,
  StatusBadge,
} from '@lastplan/ui';
import { useCallback, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { bundledCatalog } from '../../library/catalog';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { topFinding, useStructureContext } from './context';
import { useDndStore } from './dndStore';
import { canDrop, dropCommand, payloadFrom } from './dropRules';

/** Inhalte der React-Flow-Knoten. Jeder Knoten ist ein echter Button (Auswahl, Fokus, Drag-Quelle). */

/** Auswahl mit Maus: Strg/Umschalt ergänzt, sonst ersetzt. */
function useSelect(id: string) {
  return useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      const { select, toggle } = useEditorStore.getState();
      if (e.ctrlKey || e.metaKey || e.shiftKey) toggle(id);
      else select([id]);
    },
    [id],
  );
}

/** Roving Tabindex: nur ein Knoten ist per Tab erreichbar (die Auswahl, sonst der Netzanschluss). */
function useTabIndex(id: string): 0 | -1 {
  return useEditorStore((s) => {
    const anchor = s.selectedIds[0] ?? SITE_LEVEL_ID;
    return anchor === id ? 0 : -1;
  });
}

function useDragSource(id: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      const project = useProjectStore.getState().project;
      if (!project) return;
      const payload = payloadFrom(project, id, useEditorStore.getState().selectedIds);
      if (!payload) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', payload.ids.join(','));
      useDndStore.getState().start(payload);
    },
    onDragEnd: () => useDndStore.getState().end(),
  };
}

type DropState = 'none' | 'valid' | 'blocked' | 'over';

/** Drop-Ziel: Zustand für die Hervorhebung und Ereignisse. `accepts` sagt, welche Nutzlast überhaupt gemeint ist. */
function useDropTarget(id: string, accepts: (kind: string) => boolean) {
  const state = useDndStore((s): DropState => {
    if (!s.drag || !accepts(s.drag.kind)) return 'none';
    const project = useProjectStore.getState().project;
    if (!project || !canDrop(project, s.drag, id).ok) return 'blocked';
    return s.over === id ? 'over' : 'valid';
  });
  const { announce } = useStructureContext();
  return {
    state,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (state === 'none' || state === 'blocked') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (state !== 'over') useDndStore.getState().setOver(id);
      },
      onDragLeave: () => {
        if (useDndStore.getState().over === id) useDndStore.getState().setOver(null);
      },
      onDrop: (e: DragEvent) => {
        const { drag, end } = useDndStore.getState();
        const project = useProjectStore.getState().project;
        end();
        if (!drag || !project) return;
        const cmd = dropCommand(project, drag, id);
        if (!cmd) return;
        e.preventDefault();
        useProjectStore.getState().execute(cmd);
        useEditorStore.getState().select(drag.ids);
        announce(`${cmd.label}`);
      },
    },
  };
}

function Box({
  id,
  className,
  dropState,
  handlers,
  selected,
  children,
}: {
  id: string;
  className?: string;
  dropState: DropState;
  handlers: ReturnType<typeof useDropTarget>['handlers'];
  selected: boolean;
  children: ReactNode;
}) {
  const cut = useEditorStore((s) => s.clipboard?.ids.includes(id) ?? false);
  return (
    <div
      className={`structure-box nopan nodrag${className ? ` ${className}` : ''}`}
      data-selected={selected}
      data-cut={cut}
      data-drop={dropState}
      {...handlers}
    >
      {children}
    </div>
  );
}

function FindingLine({ findings }: { findings: Finding[] | undefined }) {
  const top = topFinding(findings);
  if (!top || !findings) return null;
  const more = findings.length - 1;
  return (
    <p className={`structure-flag structure-flag--${top.severity}`} title={top.message}>
      <StatusBadge status={top.severity === 'error' ? 'error' : 'warning'}>
        {top.severity === 'error' ? 'Fehler' : 'Hinweis'}
      </StatusBadge>
      <span className="structure-flag__text">
        {top.message}
        {more > 0 ? ` (+${more} weitere)` : ''}
      </span>
    </p>
  );
}

/** Mindeststrom-Summe (Worst Case = ungünstigste Phase) gegen das Limit des Clusters. */
function ClusterBar({ id }: { id: string }) {
  const { analysis } = useStructureContext();
  const level = analysis?.levelById.get(id);
  const load = analysis?.loadByLevel.get(id);
  if (!level || !load) return null;
  const used = maxPhase(load.minSum);
  const limit = minPhase(level.ownLimit);
  return (
    <div className="structure-bar">
      <p className="structure-bar__text">
        Belegt {formatA(used)} von {formatA(limit)}
      </p>
      <ProgressBar
        value={used}
        max={limit}
        label={`Mindeststrom-Summe von ${level.name}`}
        errorAt={1.0001}
      />
    </div>
  );
}

export function SiteView({ id }: { id: string }) {
  const site = useProjectStore((s) => s.project?.site);
  const selected = useEditorStore((s) => s.selectedIds.includes(id));
  const tabIndex = useTabIndex(id);
  const onClick = useSelect(id);
  const { findingsByTarget, analysis } = useStructureContext();
  const drop = useDropTarget(id, (k) => k === 'cluster');
  if (!site) return null;
  return (
    <Box id={id} dropState={drop.state} handlers={drop.handlers} selected={selected}>
      <GridNode label={site.gridConnectionLabel}>
        <button
          type="button"
          className="structure-hit"
          data-structure-id={id}
          aria-label={`Netzanschluss ${site.gridConnectionLabel} auswählen`}
          aria-pressed={selected}
          tabIndex={tabIndex}
          onClick={onClick}
        />
        <p className="structure-meta">
          Absicherung {formatA(site.gridConnectionFuseA)} · Reserve {formatA(site.buildingReserveA)}
          <br />
          Verfügbar {formatA(analysis?.siteAvailableA ?? 0)}
        </p>
        <FindingLine findings={findingsByTarget.get(id)} />
      </GridNode>
    </Box>
  );
}

export function ClusterView({ id }: { id: string }) {
  const cluster = useProjectStore((s) => s.project?.clusters.find((c) => c.id === id));
  const selected = useEditorStore((s) => s.selectedIds.includes(id));
  const tabIndex = useTabIndex(id);
  const onClick = useSelect(id);
  const source = useDragSource(id);
  const { findingsByTarget } = useStructureContext();
  const drop = useDropTarget(id, (k) => k === 'group' || k === 'cluster');
  if (!cluster) return null;
  const findings = findingsByTarget.get(id);
  const error = findings?.some((f) => f.severity === 'error') ?? false;
  return (
    <Box id={id} dropState={drop.state} handlers={drop.handlers} selected={selected}>
      <ClusterNode name={cluster.name} error={error}>
        <button
          type="button"
          className="structure-hit"
          data-structure-id={id}
          aria-label={`Cluster ${cluster.name} auswählen`}
          aria-pressed={selected}
          tabIndex={tabIndex}
          onClick={onClick}
          {...source}
        />
        <p className="structure-meta">Limit {formatA(cluster.limitA)}</p>
        <ClusterBar id={id} />
        <FindingLine findings={findings} />
      </ClusterNode>
    </Box>
  );
}

export function GroupView({ id }: { id: string }) {
  const group = useProjectStore((s) => s.project?.groups.find((g) => g.id === id));
  const selected = useEditorStore((s) => s.selectedIds.includes(id));
  const tabIndex = useTabIndex(id);
  const onClick = useSelect(id);
  const source = useDragSource(id);
  const { findingsByTarget } = useStructureContext();
  const drop = useDropTarget(id, (k) => k === 'chargePoint');
  if (!group) return null;
  return (
    <Box id={id} dropState={drop.state} handlers={drop.handlers} selected={selected}>
      <GroupNode name={group.name}>
        <button
          type="button"
          className="structure-hit"
          data-structure-id={id}
          aria-label={`Gruppe ${group.name} auswählen`}
          aria-pressed={selected}
          tabIndex={tabIndex}
          onClick={onClick}
          {...source}
        />
        <p className="structure-meta">
          Priorität {group.priority}
          {group.maxA !== undefined ? ` · max. ${formatA(group.maxA)}` : ''}
        </p>
        <FindingLine findings={findingsByTarget.get(id)} />
      </GroupNode>
    </Box>
  );
}

export function ChipView({ id }: { id: string }) {
  const cp = useProjectStore((s) => s.project?.chargePoints.find((c) => c.id === id));
  const selected = useEditorStore((s) => s.selectedIds.includes(id));
  const cut = useEditorStore((s) => s.clipboard?.ids.includes(id) ?? false);
  const tabIndex = useTabIndex(id);
  const onClick = useSelect(id);
  const source = useDragSource(id);
  const { findingsByTarget } = useStructureContext();
  if (!cp) return null;
  const findings = findingsByTarget.get(id);
  const top = topFinding(findings);
  const model = cp.libraryModelId
    ? (bundledCatalog.get(cp.libraryModelId)?.displayName ?? cp.libraryModelId)
    : 'Modell fehlt';
  const phase = cp.phases === 1 ? `1ph ${gridPhaseOf(cp.phaseRotation, 1)}` : cp.phaseRotation;
  return (
    <div className="structure-chipwrap nopan nodrag" data-cut={cut} {...source}>
      <ChargePointChip
        label={cp.label}
        model={model}
        phase={phase}
        selected={selected}
        onClick={onClick}
        tabIndex={tabIndex}
        title={model}
        data-structure-id={id}
      />
      {top ? (
        <span
          className={`structure-chipwrap__flag structure-chipwrap__flag--${top.severity}`}
          title={top.message}
        >
          <StatusBadge status={top.severity === 'error' ? 'error' : 'warning'}>
            <span className="lp-visually-hidden">
              {top.severity === 'error' ? 'Fehler' : 'Hinweis'}: {top.message}
            </span>
          </StatusBadge>
        </span>
      ) : null}
    </div>
  );
}
