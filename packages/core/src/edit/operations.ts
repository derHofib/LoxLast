import type { ProjectChange } from '../calc/changes';
import { newId } from '../ids';
import type { ChargePoint, Cluster, Group, NetworkEndpoint, Project } from '../model';

/**
 * Bearbeitungsoperationen für Struktur- und Ladepunkte-Ansicht.
 *
 * Bewusst MUTIEREND: Sie werden in der Web-App innerhalb eines Immer-Rezepts auf einem Draft
 * ausgeführt; Undo/Redo entstehen dort aus den Patches. Außerhalb von Immer nur auf Kopien anwenden.
 * IDs werden von außen übergeben bzw. vorab erzeugt, damit ein Befehl reproduzierbar bleibt.
 */

type IdFactory = () => string;

/** Setzt Felder; `undefined` entfernt ein optionales Feld (exactOptionalPropertyTypes). */
function assign<T extends object>(target: T, patch: { [K in keyof T]?: T[K] | undefined }): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) Reflect.deleteProperty(target, key);
    else (target as Record<string, unknown>)[key] = value;
  }
}

const norm = (s: string) => s.trim().toLocaleLowerCase('de-DE');

/** Erster freier Name nach Muster, z. B. „UV-3“ oder „Gruppe 2“. */
function nextFreeName(taken: readonly string[], make: (n: number) => string): string {
  const used = new Set(taken.map(norm));
  for (let n = 1; ; n++) {
    const name = make(n);
    if (!used.has(norm(name))) return name;
  }
}

/** Kopie-Name: „Mieter (Kopie)“, „Mieter (Kopie 2)“ … */
function copyName(name: string, taken: readonly string[]): string {
  return nextFreeName(taken, (n) => (n === 1 ? `${name} (Kopie)` : `${name} (Kopie ${n})`));
}

// ---------------------------------------------------------------------------------------------
// Vorschläge
// ---------------------------------------------------------------------------------------------

/** Nächste freie Ladepunkt-Bezeichnung: höchste Nummer aus „LP<n>“ + 1, mindestens zweistellig. */
export function nextChargePointLabel(
  project: Pick<Project, 'chargePoints'>,
  extraTaken: readonly string[] = [],
): string {
  const labels = [...project.chargePoints.map((cp) => cp.label), ...extraTaken];
  const numbers = labels
    .map((l) => /^LP(\d+)$/i.exec(l.trim())?.[1])
    .filter((n): n is string => n !== undefined);
  const width = Math.max(2, ...numbers.map((n) => n.length));
  let next = Math.max(0, ...numbers.map(Number)) + 1;
  const taken = new Set(labels.map(norm));
  while (taken.has(norm(`LP${String(next).padStart(width, '0')}`))) next++;
  return `LP${String(next).padStart(width, '0')}`;
}

const ipToInt = (ip: string) => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
const intToIp = (n: number) =>
  [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join('.');

/** Alle im Projekt belegten IPv4-Adressen (Ladepunkte und Zähler). */
export function usedIps(project: Project): Set<string> {
  const ips = new Set(project.chargePoints.map((cp) => cp.network.ip));
  if (project.site.gridMeter) ips.add(project.site.gridMeter.network.ip);
  if (project.site.pv?.meter) ips.add(project.site.pv.meter.network.ip);
  return ips;
}

/**
 * Vorschlag „nächste freie IP im Subnetz“ (Kap. 11.2): ab `after` (Standard: IP des zuletzt
 * angelegten Ladepunkts) aufwärts die erste freie Adresse im selben /24-Netz, ohne .0 und .255.
 * undefined, wenn es keinen Ausgangspunkt gibt oder das Netz voll ist.
 */
export function suggestNextIp(
  project: Project,
  after?: string,
  extraTaken: readonly string[] = [],
): string | undefined {
  const start = after ?? project.chargePoints.at(-1)?.network.ip;
  if (!start) return undefined;
  const taken = new Set([...usedIps(project), ...extraTaken]);
  const base = ipToInt(start);
  const network = base - (base % 256);
  for (let host = (base % 256) + 1; host <= 254; host++) {
    const candidate = intToIp(network + host);
    if (!taken.has(candidate)) return candidate;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------------------------

export interface NewClusterInput {
  id: string;
  name?: string;
  limitA?: number;
  parentClusterId?: string;
}

/** Standard-Limit für neue Cluster und Gruppen ohne Angabe (übliche Zuleitungsabsicherung). */
export const DEFAULT_CLUSTER_LIMIT_A = 63;

export function addCluster(project: Project, input: NewClusterInput): Cluster {
  const cluster: Cluster = {
    id: input.id,
    name:
      input.name ??
      nextFreeName(
        project.clusters.map((c) => c.name),
        (n) => `UV-${n}`,
      ),
    limitA: input.limitA ?? DEFAULT_CLUSTER_LIMIT_A,
    ...(input.parentClusterId !== undefined ? { parentClusterId: input.parentClusterId } : {}),
  };
  project.clusters.push(cluster);
  return cluster;
}

export interface NewGroupInput {
  id: string;
  clusterId: string;
  name?: string;
  priority?: Group['priority'];
}

export function addGroup(project: Project, input: NewGroupInput): Group {
  const siblings = project.groups.filter((g) => g.clusterId === input.clusterId).map((g) => g.name);
  const group: Group = {
    id: input.id,
    clusterId: input.clusterId,
    name: input.name ?? nextFreeName(siblings, (n) => `Gruppe ${n}`),
    priority: input.priority ?? 3,
  };
  project.groups.push(group);
  return group;
}

export type NewChargePointInput = { id: string; groupId: string } & Partial<
  Omit<ChargePoint, 'id' | 'groupId'>
>;

/**
 * Legt einen Ladepunkt an. Nicht angegebene Werte übernimmt er vom zuletzt angelegten Ladepunkt
 * (gleiche Anlage, meist gleiches Modell), Bezeichnung und IP werden fortgezählt.
 * Ohne Vorlage gelten neutrale Startwerte; `libraryModelId` muss dann angegeben werden.
 */
export function addChargePoint(project: Project, input: NewChargePointInput): ChargePoint {
  const template = project.chargePoints.at(-1);
  const ip = input.network?.ip ?? suggestNextIp(project) ?? '192.168.1.10';
  const cp: ChargePoint = {
    id: input.id,
    groupId: input.groupId,
    label: input.label ?? nextChargePointLabel(project),
    libraryModelId: input.libraryModelId ?? template?.libraryModelId ?? '',
    network: input.network ?? {
      ip,
      // 502 = registrierter Standard-Port für Modbus TCP
      port: template?.network.port ?? 502,
      ...(template?.network.unitId !== undefined ? { unitId: template.network.unitId } : {}),
    },
    protocol: input.protocol ?? template?.protocol ?? 'modbus-tcp',
    fuseA: input.fuseA ?? template?.fuseA ?? 32,
    minA: input.minA ?? template?.minA ?? 6,
    maxA: input.maxA ?? template?.maxA ?? 16,
    phases: input.phases ?? template?.phases ?? 3,
    phaseRotation: input.phaseRotation ?? 'L1-L2-L3',
    phaseSwitching: input.phaseSwitching ?? false,
    ...(input.room !== undefined
      ? { room: input.room }
      : template?.room !== undefined
        ? { room: template.room }
        : {}),
    ...(input.category !== undefined
      ? { category: input.category }
      : template?.category !== undefined
        ? { category: template.category }
        : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
  project.chargePoints.push(cp);
  return cp;
}

// ---------------------------------------------------------------------------------------------
// Ändern
// ---------------------------------------------------------------------------------------------

export type ClusterPatch = { [K in keyof Omit<Cluster, 'id'>]?: Cluster[K] | undefined };
export type GroupPatch = { [K in keyof Omit<Group, 'id'>]?: Group[K] | undefined };
/**
 * Änderung an Ladepunkten. `network` wird je Ladepunkt FELDWEISE eingemischt (nicht ersetzt),
 * damit bei Massenbearbeitung z. B. nur der Port gesetzt wird und die IPs erhalten bleiben.
 * `unitId: undefined` entfernt die Unit-ID.
 */
export type ChargePointPatch = {
  [K in keyof Omit<ChargePoint, 'id' | 'network'>]?: ChargePoint[K] | undefined;
} & { network?: { [K in keyof NetworkEndpoint]?: NetworkEndpoint[K] | undefined } };
export type SitePatch = { [K in keyof Project['site']]?: Project['site'][K] | undefined };

export function updateSite(project: Project, patch: SitePatch): void {
  assign(project.site, patch);
}

export function updateCluster(project: Project, id: string, patch: ClusterPatch): boolean {
  const cluster = project.clusters.find((c) => c.id === id);
  if (!cluster) return false;
  if (patch.parentClusterId !== undefined && !canNestCluster(project, id, patch.parentClusterId))
    return false;
  assign(cluster, patch);
  return true;
}

export function updateGroup(project: Project, id: string, patch: GroupPatch): boolean {
  const group = project.groups.find((g) => g.id === id);
  if (!group) return false;
  assign(group, patch);
  return true;
}

/** Ändert einen oder mehrere Ladepunkte (Massenbearbeitung). Liefert die Anzahl geänderter. */
export function updateChargePoints(
  project: Project,
  ids: readonly string[],
  patch: ChargePointPatch,
): number {
  const set = new Set(ids);
  let count = 0;
  for (const cp of project.chargePoints) {
    if (!set.has(cp.id)) continue;
    const { network, ...rest } = patch;
    assign(cp, rest);
    if (network) assign(cp.network, network);
    count++;
  }
  return count;
}

/** Lösungsvorschlag der Prüfung anwenden (mutierende Variante von applyChanges). */
export function applyChangesInPlace(project: Project, changes: readonly ProjectChange[]): void {
  for (const change of changes) {
    const cp = project.chargePoints.find((c) => c.id === change.chargePointId);
    if (cp) cp.phaseRotation = change.to;
  }
}

// ---------------------------------------------------------------------------------------------
// Verschieben
// ---------------------------------------------------------------------------------------------

/** Alle Cluster unterhalb von `clusterId` (rekursiv, ohne ihn selbst). Robust gegen Zyklen. */
export function descendantClusterIds(project: Project, clusterId: string): Set<string> {
  const result = new Set<string>();
  let frontier = [clusterId];
  while (frontier.length > 0) {
    const next = project.clusters.filter(
      (c) =>
        c.parentClusterId !== undefined &&
        frontier.includes(c.parentClusterId) &&
        !result.has(c.id) &&
        c.id !== clusterId,
    );
    for (const c of next) result.add(c.id);
    frontier = next.map((c) => c.id);
  }
  return result;
}

/** Darf Cluster `id` unter `parentId` gehängt werden? (kein Zyklus, Ziel existiert) */
export function canNestCluster(
  project: Project,
  id: string,
  parentId: string | undefined,
): boolean {
  if (parentId === undefined) return true;
  if (parentId === id || !project.clusters.some((c) => c.id === parentId)) return false;
  return !descendantClusterIds(project, id).has(parentId);
}

export function moveChargePoints(
  project: Project,
  ids: readonly string[],
  groupId: string,
): number {
  if (!project.groups.some((g) => g.id === groupId)) return 0;
  return updateChargePoints(
    project,
    ids.filter((id) => project.chargePoints.find((cp) => cp.id === id)?.groupId !== groupId),
    { groupId },
  );
}

export function moveGroups(project: Project, ids: readonly string[], clusterId: string): number {
  if (!project.clusters.some((c) => c.id === clusterId)) return 0;
  let count = 0;
  for (const group of project.groups) {
    if (ids.includes(group.id) && group.clusterId !== clusterId) {
      group.clusterId = clusterId;
      count++;
    }
  }
  return count;
}

export function moveCluster(project: Project, id: string, parentId: string | undefined): boolean {
  const cluster = project.clusters.find((c) => c.id === id);
  if (!cluster || !canNestCluster(project, id, parentId) || cluster.parentClusterId === parentId)
    return false;
  assign(cluster, { parentClusterId: parentId });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Löschen (mit Undo statt Rückfrage, Kap. 10.3)
// ---------------------------------------------------------------------------------------------

export interface DeleteResult {
  clusters: number;
  groups: number;
  chargePoints: number;
}

/**
 * Löscht Elemente beliebigen Typs. Kaskadiert: Cluster → Unter-Cluster, Gruppen, Ladepunkte;
 * Gruppe → ihre Ladepunkte.
 */
export function deleteElements(project: Project, ids: readonly string[]): DeleteResult {
  const clusterIds = new Set(project.clusters.filter((c) => ids.includes(c.id)).map((c) => c.id));
  for (const id of [...clusterIds])
    for (const d of descendantClusterIds(project, id)) clusterIds.add(d);
  const groupIds = new Set(
    project.groups
      .filter((g) => ids.includes(g.id) || clusterIds.has(g.clusterId))
      .map((g) => g.id),
  );
  const cpIds = new Set(
    project.chargePoints
      .filter((cp) => ids.includes(cp.id) || groupIds.has(cp.groupId))
      .map((cp) => cp.id),
  );
  project.clusters = project.clusters.filter((c) => !clusterIds.has(c.id));
  project.groups = project.groups.filter((g) => !groupIds.has(g.id));
  project.chargePoints = project.chargePoints.filter((cp) => !cpIds.has(cp.id));
  return { clusters: clusterIds.size, groups: groupIds.size, chargePoints: cpIds.size };
}

// ---------------------------------------------------------------------------------------------
// Duplizieren (Strg+D)
// ---------------------------------------------------------------------------------------------

/**
 * Dupliziert Elemente. Ladepunkte erhalten neue Bezeichnung und freie IP; Gruppen und Cluster
 * werden mit Inhalt kopiert und als „(Kopie)“ benannt. Liefert die IDs der neuen Elemente
 * (nur die direkt duplizierten, nicht deren Inhalt) für die Auswahl.
 */
export function duplicateElements(
  project: Project,
  ids: readonly string[],
  idFactory: IdFactory = newId,
): string[] {
  const created: string[] = [];
  const newLabels: string[] = [];
  const newIps: string[] = [];

  const copyChargePoint = (cp: ChargePoint, groupId: string): ChargePoint => {
    const label = nextChargePointLabel(project, newLabels);
    newLabels.push(label);
    const ip =
      suggestNextIp(project, project.chargePoints.at(-1)?.network.ip, newIps) ?? cp.network.ip;
    newIps.push(ip);
    const copy: ChargePoint = {
      ...cp,
      id: idFactory(),
      groupId,
      label,
      network: { ...cp.network, ip },
    };
    project.chargePoints.push(copy);
    return copy;
  };

  const copyGroup = (group: Group, clusterId: string, rename: boolean): Group => {
    const siblings = project.groups.filter((g) => g.clusterId === clusterId).map((g) => g.name);
    const copy: Group = {
      ...group,
      id: idFactory(),
      clusterId,
      name: rename ? copyName(group.name, siblings) : group.name,
    };
    project.groups.push(copy);
    for (const cp of project.chargePoints.filter((c) => c.groupId === group.id))
      copyChargePoint(cp, copy.id);
    return copy;
  };

  const copyCluster = (cluster: Cluster, parentClusterId: string | undefined): Cluster => {
    const copy: Cluster = {
      ...cluster,
      id: idFactory(),
      name: copyName(
        cluster.name,
        project.clusters.map((c) => c.name),
      ),
    };
    assign(copy, { parentClusterId });
    project.clusters.push(copy);
    for (const g of project.groups.filter((g) => g.clusterId === cluster.id))
      copyGroup(g, copy.id, false);
    for (const child of project.clusters.filter(
      (c) => c.parentClusterId === cluster.id && c.id !== copy.id,
    )) {
      copyCluster(child, copy.id);
    }
    return copy;
  };

  for (const id of ids) {
    const cluster = project.clusters.find((c) => c.id === id);
    const group = project.groups.find((g) => g.id === id);
    const cp = project.chargePoints.find((c) => c.id === id);
    if (cluster) created.push(copyCluster(cluster, cluster.parentClusterId).id);
    else if (group) created.push(copyGroup(group, group.clusterId, true).id);
    else if (cp) created.push(copyChargePoint(cp, cp.groupId).id);
  }
  return created;
}
