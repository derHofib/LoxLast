import type { ChargePoint, Cluster, Group, Project } from '../model';
import { PHASES, gridPhaseOf, loadedPhases, phaseValues, spread, type PhaseValues } from './phases';

/**
 * Hierarchie, verfügbare Limits und Worst-Case-Lasten je Ebene (Kap. 4.1–4.4).
 * Reine Funktion; wird einmal je Prüflauf berechnet und von allen Prüfregeln geteilt.
 *
 * Robust gegen fehlerhafte Strukturen (fehlende Referenzen, Zyklen): solche Elemente werden
 * so eingeordnet, dass ihre Last am Standort trotzdem zählt. Die Strukturfehler selbst
 * meldet die Invariantenprüfung.
 */

export type LevelKind = 'site' | 'cluster' | 'group';

export const SITE_LEVEL_ID = 'site';

export interface Level {
  kind: LevelKind;
  /** 'site' oder ID des Clusters bzw. der Gruppe. */
  id: string;
  /** Anzeigename: „Standort“, Clustername oder „Clustername › Gruppe“. */
  name: string;
  /** Übergeordnete Ebene; fehlt nur beim Standort. */
  parentId?: string;
  /** Eigenes Limit je Phase (Sicherung/Limit dieser Ebene, ∞ wenn keins). */
  ownLimit: PhaseValues;
  /** Wirksam verfügbares Limit je Phase = min(eigenes Limit, verfügbares Limit der Elternebene). */
  available: PhaseValues;
  /** Alle Ladepunkte unterhalb dieser Ebene (rekursiv). */
  chargePointIds: string[];
}

export interface LevelLoad {
  /** Szenario A: alle Fahrzeuge 3-phasig, Summe maxA je belegter Phase. */
  allThreePhase: PhaseValues;
  /** Szenario B: alle Fahrzeuge 1-phasig, maxA auf der Netzphase von Fahrzeugphase 1. */
  allSinglePhase: PhaseValues;
  /** Worst Case je Phase = max(A, B). */
  worstCase: PhaseValues;
  /** Schieflast = größte Phasendifferenz in Szenario B. */
  unbalanceA: number;
  /** Summe der wirksamen Mindestströme je Phase (Szenario A, ungünstigster Fall). */
  minSum: PhaseValues;
}

export interface ChargePointInfo {
  chargePoint: ChargePoint;
  group?: Group;
  /** Wirksamer Mindeststrom: group.minPerChargePointA, sonst cp.minA. */
  effectiveMinA: number;
  /** Ebenen von unten nach oben: Gruppe (falls vorhanden), Cluster-Kette, Standort. */
  levelIds: string[];
}

export interface ProjectAnalysis {
  /** Standort, Cluster (von oben nach unten), Gruppen. */
  levels: Level[];
  levelById: Map<string, Level>;
  loadByLevel: Map<string, LevelLoad>;
  chargePoints: Map<string, ChargePointInfo>;
  siteAvailableA: number;
}

const INF = Number.POSITIVE_INFINITY;

const minValues = (a: PhaseValues, b: PhaseValues): PhaseValues =>
  phaseValues(Math.min(a.L1, b.L1), Math.min(a.L2, b.L2), Math.min(a.L3, b.L3));

/** Verfügbares Limit am Standort: Netzanschluss minus Gebäudereserve, je Phase gleich (ADR 0007). */
export function siteAvailableA(project: Project): number {
  return Math.max(0, project.site.gridConnectionFuseA - project.site.buildingReserveA);
}

/** Eigenes Limit eines Clusters je Phase: abweichende Phasen-Limits haben Vorrang. */
export function clusterOwnLimit(cluster: Cluster): PhaseValues {
  return cluster.phaseLimitA ? phaseValues(...cluster.phaseLimitA) : phaseValues(cluster.limitA);
}

/**
 * Übergeordneter Cluster, sofern vorhanden und nicht Teil eines Zyklus.
 * Bei Zyklen oder fehlenden Eltern hängt der Cluster direkt am Standort.
 */
function resolveParents(clusters: Cluster[]): Map<string, string | undefined> {
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const parent = new Map<string, string | undefined>();
  for (const cluster of clusters) {
    const seen = new Set<string>([cluster.id]);
    let current = cluster.parentClusterId;
    let ok = true;
    while (current !== undefined) {
      const next = byId.get(current);
      if (!next || seen.has(current)) {
        ok = false;
        break;
      }
      seen.add(current);
      current = next.parentClusterId;
    }
    parent.set(cluster.id, ok ? cluster.parentClusterId : undefined);
  }
  return parent;
}

export function analyzeProject(project: Project): ProjectAnalysis {
  const siteA = siteAvailableA(project);
  const site: Level = {
    kind: 'site',
    id: SITE_LEVEL_ID,
    name: 'Standort',
    ownLimit: phaseValues(siteA),
    available: phaseValues(siteA),
    chargePointIds: [],
  };
  const levels: Level[] = [site];
  const levelById = new Map<string, Level>([[SITE_LEVEL_ID, site]]);

  // Cluster von oben nach unten anlegen, damit die Elternebene immer zuerst berechnet ist.
  const parentOf = resolveParents(project.clusters);
  const pending = [...project.clusters];
  while (pending.length > 0) {
    const index = pending.findIndex((c) => {
      const p = parentOf.get(c.id);
      return p === undefined || levelById.has(p);
    });
    // Nach resolveParents gibt es keine Zyklen mehr; index ist immer ≥ 0.
    const [cluster] = pending.splice(Math.max(index, 0), 1) as [Cluster];
    const parent = levelById.get(parentOf.get(cluster.id) ?? SITE_LEVEL_ID) ?? site;
    const ownLimit = clusterOwnLimit(cluster);
    const level: Level = {
      kind: 'cluster',
      id: cluster.id,
      name: cluster.name,
      parentId: parent.id,
      ownLimit,
      available: minValues(ownLimit, parent.available),
      chargePointIds: [],
    };
    levels.push(level);
    levelById.set(cluster.id, level);
  }

  const groupById = new Map<string, Group>();
  for (const group of project.groups) {
    groupById.set(group.id, group);
    const parent = levelById.get(group.clusterId);
    if (!parent || parent.kind !== 'cluster') continue; // verwaiste Gruppe: zählt nur am Standort
    const ownLimit = phaseValues(group.maxA ?? INF);
    const level: Level = {
      kind: 'group',
      id: group.id,
      name: `${parent.name} › ${group.name}`,
      parentId: parent.id,
      ownLimit,
      available: minValues(ownLimit, parent.available),
      chargePointIds: [],
    };
    levels.push(level);
    levelById.set(group.id, level);
  }

  const chargePoints = new Map<string, ChargePointInfo>();
  const loadByLevel = new Map<string, LevelLoad>(
    levels.map((l) => [
      l.id,
      {
        allThreePhase: phaseValues(0),
        allSinglePhase: phaseValues(0),
        worstCase: phaseValues(0),
        unbalanceA: 0,
        minSum: phaseValues(0),
      },
    ]),
  );

  for (const cp of project.chargePoints) {
    const group = groupById.get(cp.groupId);
    const effectiveMinA = group?.minPerChargePointA ?? cp.minA;
    const levelIds: string[] = [];
    let current = levelById.get(cp.groupId) ?? site;
    for (;;) {
      levelIds.push(current.id);
      if (current.parentId === undefined) break;
      current = levelById.get(current.parentId) ?? site;
    }
    chargePoints.set(cp.id, {
      chargePoint: cp,
      ...(group ? { group } : {}),
      effectiveMinA,
      levelIds,
    });

    const threePhaseLoad = loadedPhases(cp, 3);
    const singlePhase = gridPhaseOf(cp.phaseRotation, 1);
    for (const levelId of levelIds) {
      (levelById.get(levelId) as Level).chargePointIds.push(cp.id);
      const load = loadByLevel.get(levelId) as LevelLoad;
      for (const phase of threePhaseLoad) {
        load.allThreePhase[phase] += cp.maxA;
        load.minSum[phase] += effectiveMinA;
      }
      load.allSinglePhase[singlePhase] += cp.maxA;
    }
  }

  for (const load of loadByLevel.values()) {
    for (const phase of PHASES) {
      load.worstCase[phase] = Math.max(load.allThreePhase[phase], load.allSinglePhase[phase]);
    }
    load.unbalanceA = spread(load.allSinglePhase);
  }

  return { levels, levelById, loadByLevel, chargePoints, siteAvailableA: siteA };
}
