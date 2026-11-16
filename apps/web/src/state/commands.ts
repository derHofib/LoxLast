import {
  addChargePoint,
  addCluster,
  addGroup,
  applyChangesInPlace,
  confirmChargePointFields,
  applyImport,
  deleteElements,
  duplicateElements,
  moveChargePoints,
  moveCluster,
  moveGroups,
  newId,
  updateChargePoints,
  updateCluster,
  updateGroup,
  updateSite,
  type ChargePointDataField,
  type ChargePointPatch,
  type ClusterPatch,
  type FixProposal,
  type GroupPatch,
  type NewChargePointInput,
  type NewClusterInput,
  type NewGroupInput,
  type Project,
  type SitePatch,
  type ValidImportRow,
} from '@lastplan/core';
import { command, type Command } from './history';

/**
 * Befehle der Struktur- und Ladepunkte-Ansicht (Undo/Redo über Immer-Patches, ADR 0010).
 * IDs werden vor dem Befehl erzeugt, damit die Ansicht das neue Element sofort auswählen kann.
 */

export interface Created<T extends string = string> {
  command: Command;
  id: T;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export function addClusterCommand(input: Omit<NewClusterInput, 'id'> = {}): Created {
  const id = newId();
  return { id, command: command('Cluster anlegen', (d) => void addCluster(d, { ...input, id })) };
}

export function addGroupCommand(input: Omit<NewGroupInput, 'id'>): Created {
  const id = newId();
  return { id, command: command('Gruppe anlegen', (d) => void addGroup(d, { ...input, id })) };
}

export function addChargePointCommand(input: Omit<NewChargePointInput, 'id'>): Created {
  const id = newId();
  return {
    id,
    command: command('Ladepunkt anlegen', (d) => void addChargePoint(d, { ...input, id })),
  };
}

export const updateSiteCommand = (patch: SitePatch): Command =>
  command('Netzanschluss ändern', (d) => updateSite(d, patch));

export const updateClusterCommand = (
  id: string,
  patch: ClusterPatch,
  label = 'Cluster ändern',
): Command => command(label, (d) => void updateCluster(d, id, patch));

export const updateGroupCommand = (
  id: string,
  patch: GroupPatch,
  label = 'Gruppe ändern',
): Command => command(label, (d) => void updateGroup(d, id, patch));

/** Ändert einen oder mehrere Ladepunkte in einem Undo-Schritt (Massenbearbeitung). */
export function updateChargePointsCommand(
  ids: readonly string[],
  patch: ChargePointPatch,
): Command {
  return command(
    ids.length === 1 ? 'Ladepunkt ändern' : `${ids.length} Ladepunkte ändern`,
    (d) => void updateChargePoints(d, ids, patch),
  );
}

export const moveChargePointsCommand = (ids: readonly string[], groupId: string): Command =>
  command(
    plural(ids.length, 'Ladepunkt verschieben', 'Ladepunkte verschieben'),
    (d) => void moveChargePoints(d, ids, groupId),
  );

export const moveGroupsCommand = (ids: readonly string[], clusterId: string): Command =>
  command(
    plural(ids.length, 'Gruppe verschieben', 'Gruppen verschieben'),
    (d) => void moveGroups(d, ids, clusterId),
  );

export const moveClusterCommand = (id: string, parentId: string | undefined): Command =>
  command('Cluster verschieben', (d) => void moveCluster(d, id, parentId));

/** Bezeichnung für Undo, z. B. „LP01 löschen“ oder „3 Elemente löschen“. */
function describe(project: Project, ids: readonly string[]): string {
  if (ids.length !== 1) return `${ids.length} Elemente`;
  const id = ids[0];
  return (
    project.chargePoints.find((c) => c.id === id)?.label ??
    project.groups.find((g) => g.id === id)?.name ??
    project.clusters.find((c) => c.id === id)?.name ??
    'Element'
  );
}

/** Löschen mit Undo statt Rückfrage (Kap. 10.3). */
export const deleteCommand = (project: Project, ids: readonly string[]): Command =>
  command(`${describe(project, ids)} löschen`, (d) => void deleteElements(d, ids));

/**
 * Duplizieren (Strg+D). Die IDs der Kopien stehen nach dem Ausführen in `created`.
 * Immer führt das Rezept genau einmal aus; Redo spielt nur die Patches ab, daher bleiben die IDs stabil.
 */
export function duplicateCommand(
  project: Project,
  ids: readonly string[],
): { command: Command; created: string[] } {
  const created: string[] = [];
  return {
    created,
    command: command(`${describe(project, ids)} duplizieren`, (d) => {
      created.push(...duplicateElements(d, ids, newId));
    }),
  };
}

/** Lösungsvorschlag der Prüfung übernehmen – ein Undo-Schritt (Kap. 5). */
export const applyFixCommand = (fix: FixProposal): Command =>
  command(fix.label, (d) => applyChangesInPlace(d, fix.changes));

/**
 * CSV-Import (Kap. 11.2): alle fehlerfreien Zeilen in einem Undo-Schritt.
 * IDs entstehen vorab, damit die Ansicht die neuen Ladepunkte auswählen kann.
 */
export function importChargePointsCommand(rows: readonly ValidImportRow[]): {
  command: Command;
  ids: string[];
} {
  const ids = rows.map(() => newId());
  return {
    ids,
    command: command(
      plural(rows.length, '1 Ladepunkt importiert', 'Ladepunkte importiert'),
      (d) => {
        let i = 0;
        applyImport(d, rows, () => ids[i++] ?? newId());
      },
    ),
  };
}

/** Platzhalter-Werte bestätigen (Vermerk „fehlt“ entfällt, Werte bleiben). */
export function confirmChargePointFieldsCommand(
  ids: readonly string[],
  fields: readonly ChargePointDataField[],
): Command {
  return command(
    ids.length === 1 ? 'Angabe bestätigen' : `Angaben bei ${ids.length} Ladepunkten bestätigen`,
    (draft) => {
      confirmChargePointFields(draft, ids, fields);
    },
  );
}
