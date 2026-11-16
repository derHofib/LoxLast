import { addChargePoint, addCluster, addGroup, newId, type Project } from '@lastplan/core';
import { bundledCatalog, bundledLibrary } from '../../library/catalog';
import { command, type Command } from '../../state/history';
import { kindOf } from './dropRules';

/**
 * Anlegen aus der Struktur-Ansicht: „+ Cluster“, „+ Gruppe“, „+ Ladepunkt“ und das Kürzel N.
 * Jede Aktion wählt ein sinnvolles Standardelternelement aus der Auswahl und legt fehlende
 * Eltern gleich mit an (ein Undo-Schritt). Das neue Element wird anschließend ausgewählt.
 */

export interface CreateAction {
  command: Command;
  /** ID des neuen Elements (wird ausgewählt). */
  id: string;
  /** Kurze Rückmeldung für die Statuszeile, z. B. „Gruppe „Gruppe 2“ in UV-1 angelegt“. */
  message: string;
}

/** Modell für den ersten Ladepunkt: erstes Modell der mitgelieferten Bibliothek (kein erfundenes Modell). */
export function defaultModelId(): string | undefined {
  return bundledLibrary.models.find((m) => m.model !== undefined && bundledCatalog.get(m.model.id))
    ?.model?.id;
}

/** Cluster zur Auswahl: der Cluster selbst, der Cluster der Gruppe/des Ladepunkts, sonst der zuletzt angelegte. */
export function clusterForSelection(
  project: Project,
  selectedId: string | undefined,
): string | undefined {
  const kind = selectedId === undefined ? undefined : kindOf(project, selectedId);
  if (selectedId !== undefined) {
    if (kind === 'cluster') return selectedId;
    if (kind === 'group') return project.groups.find((g) => g.id === selectedId)?.clusterId;
    if (kind === 'chargePoint') {
      const groupId = project.chargePoints.find((c) => c.id === selectedId)?.groupId;
      return project.groups.find((g) => g.id === groupId)?.clusterId;
    }
  }
  return project.clusters.at(-1)?.id;
}

/** Gruppe zur Auswahl: die Gruppe selbst, die des Ladepunkts, die erste im Cluster, sonst die zuletzt angelegte. */
export function groupForSelection(
  project: Project,
  selectedId: string | undefined,
): string | undefined {
  const kind = selectedId === undefined ? undefined : kindOf(project, selectedId);
  if (selectedId !== undefined) {
    if (kind === 'group') return selectedId;
    if (kind === 'chargePoint')
      return project.chargePoints.find((c) => c.id === selectedId)?.groupId;
    if (kind === 'cluster') {
      const inCluster = project.groups.find((g) => g.clusterId === selectedId);
      if (inCluster) return inCluster.id;
    }
  }
  return project.groups.at(-1)?.id;
}

export function createCluster(): CreateAction {
  const id = newId();
  let name = '';
  return {
    id,
    get message() {
      return `Cluster „${name}“ angelegt`;
    },
    command: command('Cluster anlegen', (d) => {
      name = addCluster(d, { id }).name;
    }),
  };
}

/** Untercluster im angegebenen Cluster (Schaltfläche im Eigenschaften-Panel). */
export function createSubCluster(parentId: string): CreateAction {
  const id = newId();
  let name = '';
  return {
    id,
    get message() {
      return `Cluster „${name}“ angelegt`;
    },
    command: command('Cluster anlegen', (d) => {
      name = addCluster(d, { id, parentClusterId: parentId }).name;
    }),
  };
}

export function createGroup(project: Project, selectedId: string | undefined): CreateAction {
  const id = newId();
  const clusterId = clusterForSelection(project, selectedId);
  let name = '';
  return {
    id,
    get message() {
      return `Gruppe „${name}“ angelegt`;
    },
    command: command('Gruppe anlegen', (d) => {
      const target = clusterId ?? addCluster(d, { id: newId() }).id;
      name = addGroup(d, { id, clusterId: target }).name;
    }),
  };
}

export function createChargePoint(project: Project, selectedId: string | undefined): CreateAction {
  const id = newId();
  const groupId = groupForSelection(project, selectedId);
  const modelId = project.chargePoints.length === 0 ? defaultModelId() : undefined;
  let label = '';
  return {
    id,
    get message() {
      return `Ladepunkt ${label} angelegt`;
    },
    command: command('Ladepunkt anlegen', (d) => {
      let target = groupId;
      if (target === undefined) {
        const clusterId = clusterForSelection(d, selectedId) ?? addCluster(d, { id: newId() }).id;
        target = addGroup(d, { id: newId(), clusterId }).id;
      }
      label = addChargePoint(d, {
        id,
        groupId: target,
        ...(modelId !== undefined ? { libraryModelId: modelId } : {}),
      }).label;
    }),
  };
}
