import { IEC_MIN_CHARGING_CURRENT_A } from './primitives';
import { ProjectSchema, type Cluster, type Project } from './project';

/**
 * Fachliche Invarianten des Projekts (Kap. 3).
 * Reine Funktion; die Prüfregeln aus Meilenstein 2 bauen darauf auf.
 */

export type InvariantCode =
  | 'DUPLICATE_ID'
  | 'DUPLICATE_CP_LABEL'
  | 'DUPLICATE_CLUSTER_NAME'
  | 'DUPLICATE_GROUP_NAME'
  | 'GROUP_CLUSTER_MISSING'
  | 'CP_GROUP_MISSING'
  | 'CLUSTER_PARENT_MISSING'
  | 'CLUSTER_CYCLE'
  | 'CP_CURRENT_RANGE';

export interface InvariantIssue {
  code: InvariantCode;
  /** Deutsch, konkret mit Werten. */
  message: string;
  /** Betroffene Elemente (zum Hinspringen in der UI). */
  targetIds: string[];
  /** Pfad im Projektobjekt, z. B. ['chargePoints', 3, 'minA']. */
  path: (string | number)[];
}

/** Normalisiert Namen für Eindeutigkeitsvergleiche: Groß-/Kleinschreibung und Rand-Leerzeichen egal. */
const normalizeName = (s: string) => s.trim().toLocaleLowerCase('de-DE');

interface Indexed<T> {
  item: T;
  index: number;
}
/** Mindestens zwei Einträge mit gleichem Schlüssel. */
type DuplicateSet<T> = [Indexed<T>, Indexed<T>, ...Indexed<T>[]];

function findDuplicates<T>(items: readonly T[], key: (item: T) => string): DuplicateSet<T>[] {
  const byKey = new Map<string, Indexed<T>[]>();
  items.forEach((item, index) => {
    const k = key(item);
    const list = byKey.get(k);
    if (list) list.push({ item, index });
    else byKey.set(k, [{ item, index }]);
  });
  return [...byKey.values()].filter((list): list is DuplicateSet<T> => list.length > 1);
}

export function checkProjectInvariants(project: Project): InvariantIssue[] {
  const issues: InvariantIssue[] = [];
  const { clusters, groups, chargePoints } = project;

  // Eindeutige IDs über alle Elemente
  const allIds: { id: string; path: (string | number)[] }[] = [
    ...clusters.map((c, i) => ({ id: c.id, path: ['clusters', i] })),
    ...groups.map((g, i) => ({ id: g.id, path: ['groups', i] })),
    ...chargePoints.map((cp, i) => ({ id: cp.id, path: ['chargePoints', i] })),
  ];
  for (const dup of findDuplicates(allIds, (e) => e.id)) {
    issues.push({
      code: 'DUPLICATE_ID',
      message: `ID ${dup[0].item.id} ist ${dup.length}-mal vergeben`,
      targetIds: [dup[0].item.id],
      path: [...dup[1].item.path, 'id'],
    });
  }

  // Eindeutige Bezeichnungen (Namen werden zu Loxone-Objektnamen, siehe NamingScheme)
  for (const dup of findDuplicates(chargePoints, (cp) => normalizeName(cp.label))) {
    issues.push({
      code: 'DUPLICATE_CP_LABEL',
      message: `Ladepunkt-Bezeichnung „${dup[0].item.label}“ ist ${dup.length}-mal vergeben`,
      targetIds: dup.map((d) => d.item.id),
      path: ['chargePoints', dup[1].index, 'label'],
    });
  }
  for (const dup of findDuplicates(clusters, (c) => normalizeName(c.name))) {
    issues.push({
      code: 'DUPLICATE_CLUSTER_NAME',
      message: `Clustername „${dup[0].item.name}“ ist ${dup.length}-mal vergeben`,
      targetIds: dup.map((d) => d.item.id),
      path: ['clusters', dup[1].index, 'name'],
    });
  }
  // Gruppennamen nur innerhalb eines Clusters eindeutig (Loxone-Name: LIM_{cluster}_{group})
  for (const dup of findDuplicates(groups, (g) => `${g.clusterId}\u0000${normalizeName(g.name)}`)) {
    issues.push({
      code: 'DUPLICATE_GROUP_NAME',
      message: `Gruppenname „${dup[0].item.name}“ ist im selben Cluster ${dup.length}-mal vergeben`,
      targetIds: dup.map((d) => d.item.id),
      path: ['groups', dup[1].index, 'name'],
    });
  }

  // Referenzen
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  const groupIds = new Set(groups.map((g) => g.id));

  groups.forEach((g, i) => {
    if (!clusterById.has(g.clusterId)) {
      issues.push({
        code: 'GROUP_CLUSTER_MISSING',
        message: `Gruppe „${g.name}“ verweist auf einen Cluster, den es nicht gibt`,
        targetIds: [g.id],
        path: ['groups', i, 'clusterId'],
      });
    }
  });

  chargePoints.forEach((cp, i) => {
    if (!groupIds.has(cp.groupId)) {
      issues.push({
        code: 'CP_GROUP_MISSING',
        message: `${cp.label} ist keiner vorhandenen Gruppe zugeordnet`,
        targetIds: [cp.id],
        path: ['chargePoints', i, 'groupId'],
      });
    }
  });

  clusters.forEach((c, i) => {
    if (c.parentClusterId !== undefined && !clusterById.has(c.parentClusterId)) {
      issues.push({
        code: 'CLUSTER_PARENT_MISSING',
        message: `Cluster „${c.name}“ verweist auf einen übergeordneten Cluster, den es nicht gibt`,
        targetIds: [c.id],
        path: ['clusters', i, 'parentClusterId'],
      });
    }
  });

  // Zyklen bei verschachtelten Clustern: jeden Zyklus genau einmal melden
  const reportedCycles = new Set<string>();
  clusters.forEach((start, i) => {
    const chain: Cluster[] = [];
    let current: Cluster | undefined = start;
    while (current && !chain.includes(current)) {
      chain.push(current);
      current =
        current.parentClusterId === undefined
          ? undefined
          : clusterById.get(current.parentClusterId);
    }
    if (!current) return;
    const cycle = chain.slice(chain.indexOf(current));
    const key = cycle
      .map((c) => c.id)
      .sort()
      .join('|');
    if (reportedCycles.has(key)) return;
    reportedCycles.add(key);
    const names = cycle.map((c) => c.name);
    issues.push({
      code: 'CLUSTER_CYCLE',
      message: `Cluster sind im Kreis verschachtelt: ${[...names, current.name].join(' › ')}`,
      targetIds: cycle.map((c) => c.id),
      path: ['clusters', i, 'parentClusterId'],
    });
  });

  // 6 A ≤ minA ≤ maxA ≤ fuseA
  chargePoints.forEach((cp, i) => {
    const problems: string[] = [];
    if (cp.minA < IEC_MIN_CHARGING_CURRENT_A) {
      problems.push(
        `Mindeststrom ${formatA(cp.minA)} unter ${IEC_MIN_CHARGING_CURRENT_A} A (IEC 61851)`,
      );
    }
    if (cp.minA > cp.maxA) {
      problems.push(`Mindeststrom ${formatA(cp.minA)} über Maximalstrom ${formatA(cp.maxA)}`);
    }
    if (cp.maxA > cp.fuseA) {
      problems.push(`Maximalstrom ${formatA(cp.maxA)} über Absicherung ${formatA(cp.fuseA)}`);
    }
    if (problems.length > 0) {
      const minProblem = cp.minA < IEC_MIN_CHARGING_CURRENT_A || cp.minA > cp.maxA;
      issues.push({
        code: 'CP_CURRENT_RANGE',
        message: `${cp.label}: ${problems.join('; ')}`,
        targetIds: [cp.id],
        path: ['chargePoints', i, minProblem ? 'minA' : 'maxA'],
      });
    }
  });

  return issues;
}

/** Deutsches Zahlenformat mit Einheit, z. B. „7,5 A“. Ausführliche Formatierung folgt in calc (Meilenstein 2). */
function formatA(value: number): string {
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} A`;
}

/** Form + Invarianten. Für Import und Export. */
export const StrictProjectSchema = ProjectSchema.superRefine((project, ctx) => {
  for (const issue of checkProjectInvariants(project)) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  }
});
