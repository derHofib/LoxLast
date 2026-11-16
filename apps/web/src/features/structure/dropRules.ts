import {
  canNestCluster,
  moveChargePoints,
  moveCluster,
  moveGroups,
  SITE_LEVEL_ID,
  type Project,
} from '@lastplan/core';
import { command, type Command } from '../../state/history';
import type { ElementKind } from './tree';

/**
 * Regeln für Drag & Drop und Ausschneiden/Einfügen (Kap. 10.3, 11.1).
 * Reine Funktionen; die Ansicht ruft sie bei dragover/drop und bei Strg+V auf.
 */

export type MovableKind = Exclude<ElementKind, 'site'>;

export interface DragPayload {
  kind: MovableKind;
  ids: readonly string[];
}

export type DropCheck = { ok: true } | { ok: false; reason: string };

export function kindOf(project: Project, id: string): ElementKind | undefined {
  if (id === SITE_LEVEL_ID) return 'site';
  if (project.chargePoints.some((c) => c.id === id)) return 'chargePoint';
  if (project.groups.some((g) => g.id === id)) return 'group';
  if (project.clusters.some((c) => c.id === id)) return 'cluster';
  return undefined;
}

/**
 * Nutzlast aus einer Auswahl: nur Elemente der Art des angefassten (bzw. ersten) Elements.
 * Ist das angefasste Element nicht Teil der Auswahl, wird nur es bewegt.
 */
export function payloadFrom(
  project: Project,
  grabbedId: string,
  selectedIds: readonly string[],
): DragPayload | undefined {
  const kind = kindOf(project, grabbedId);
  if (kind === undefined || kind === 'site') return undefined;
  const ids = selectedIds.includes(grabbedId)
    ? selectedIds.filter((id) => kindOf(project, id) === kind)
    : [grabbedId];
  return { kind, ids: kind === 'cluster' ? [grabbedId] : ids };
}

/** Nutzlast für Ausschneiden: Auswahl, sofern einheitlich bewegbar. */
export function payloadFromSelection(
  project: Project,
  selectedIds: readonly string[],
): DragPayload | undefined {
  const first = selectedIds.find((id) => kindOf(project, id) !== 'site' && kindOf(project, id));
  return first === undefined ? undefined : payloadFrom(project, first, selectedIds);
}

const TARGET_KIND: Record<MovableKind, ElementKind[]> = {
  chargePoint: ['group'],
  group: ['cluster'],
  cluster: ['cluster', 'site'],
};

const TARGET_NAME: Record<MovableKind, string> = {
  chargePoint: 'eine Gruppe',
  group: 'einen Cluster',
  cluster: 'einen Cluster oder den Netzanschluss',
};

export function canDrop(project: Project, payload: DragPayload, targetId: string): DropCheck {
  const targetKind = kindOf(project, targetId);
  if (targetKind === undefined || !TARGET_KIND[payload.kind].includes(targetKind)) {
    return {
      ok: false,
      reason: `Hier nicht möglich – Ziel muss ${TARGET_NAME[payload.kind]} sein`,
    };
  }
  if (payload.ids.length === 0) return { ok: false, reason: 'Nichts zum Verschieben ausgewählt' };

  if (payload.kind === 'cluster') {
    const id = payload.ids[0] as string;
    const parentId = targetId === SITE_LEVEL_ID ? undefined : targetId;
    if (!canNestCluster(project, id, parentId)) {
      return {
        ok: false,
        reason: 'Ein Cluster kann nicht in sich selbst oder einen Unter-Cluster',
      };
    }
    const current = project.clusters.find((c) => c.id === id)?.parentClusterId;
    if (current === parentId) return { ok: false, reason: 'Liegt bereits dort' };
    return { ok: true };
  }

  const alreadyThere =
    payload.kind === 'chargePoint'
      ? payload.ids.every(
          (id) => project.chargePoints.find((c) => c.id === id)?.groupId === targetId,
        )
      : payload.ids.every((id) => project.groups.find((g) => g.id === id)?.clusterId === targetId);
  return alreadyThere ? { ok: false, reason: 'Liegt bereits dort' } : { ok: true };
}

/** Befehl für einen gültigen Drop; null, wenn nicht erlaubt. */
export function dropCommand(
  project: Project,
  payload: DragPayload,
  targetId: string,
): Command | null {
  if (!canDrop(project, payload, targetId).ok) return null;
  const { ids } = payload;
  switch (payload.kind) {
    case 'chargePoint':
      return command(
        ids.length === 1 ? 'Ladepunkt verschieben' : `${ids.length} Ladepunkte verschieben`,
        (d) => void moveChargePoints(d, ids, targetId),
      );
    case 'group':
      return command(
        ids.length === 1 ? 'Gruppe verschieben' : `${ids.length} Gruppen verschieben`,
        (d) => void moveGroups(d, ids, targetId),
      );
    case 'cluster':
      return command(
        'Cluster verschieben',
        (d) =>
          void moveCluster(d, ids[0] as string, targetId === SITE_LEVEL_ID ? undefined : targetId),
      );
  }
}

/**
 * Einfüge-Ziel für Strg+V aus der Auswahl: das Element selbst, wenn es passt, sonst der nächste
 * passende Vorfahre (z. B. Ladepunkt eingefügt bei ausgewähltem Ladepunkt → dessen Gruppe).
 */
export function pasteTarget(
  project: Project,
  kind: MovableKind,
  selectedId: string | undefined,
): string | undefined {
  if (selectedId === undefined) return kind === 'cluster' ? SITE_LEVEL_ID : undefined;
  let current: string | undefined = selectedId;
  const guard = new Set<string>();
  while (current !== undefined && !guard.has(current)) {
    guard.add(current);
    const k = kindOf(project, current);
    if (k !== undefined && TARGET_KIND[kind].includes(k)) return current;
    current =
      k === 'chargePoint'
        ? project.chargePoints.find((c) => c.id === current)?.groupId
        : k === 'group'
          ? project.groups.find((g) => g.id === current)?.clusterId
          : k === 'cluster'
            ? (project.clusters.find((c) => c.id === current)?.parentClusterId ?? SITE_LEVEL_ID)
            : undefined;
  }
  return undefined;
}
