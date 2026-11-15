import type { Project } from '../model';
import { analyzeProject, type ProjectAnalysis } from './analysis';
import { applyChanges, type ProjectChange } from './changes';
import { PHASES, gridPhaseOf, rotationForPhase1, type Phase } from './phases';

/**
 * Schieflast-Optimierung (Kap. 5, Auto-Fix für UNBALANCE).
 *
 * Die Phasenrotation legt fest, auf welcher Netzphase Fahrzeugphase 1 liegt. Bei 3-phasig
 * angeschlossenen Ladepunkten ändert das nur Szenario B (alle Fahrzeuge 1-phasig); Szenario A und
 * Mindeststrom-Summen bleiben gleich. 1-phasig angeschlossene Ladepunkte wandern dagegen komplett
 * auf eine andere Phase. Erzeugt der Vorschlag dadurch eine neue Mindeststrom-Überschreitung
 * (z. B. bei abweichenden Phasen-Limits), wird er verworfen und nur mit 3-phasigen Ladepunkten
 * neu berechnet. So verschlechtert der Vorschlag keine andere Prüfung.
 *
 * Ziel (lexikografisch): 1. Schieflast am Standort, 2. Summe der Schieflasten aller Cluster,
 * 3. möglichst wenige geänderte Ladepunkte.
 * Verfahren: Greedy (größter Strom zuerst auf die am wenigsten belastete Phase) und lokale Suche
 * (einzelne Ladepunkte umsetzen, solange es besser wird), jeweils ab Ist-Zustand und ab Greedy.
 */

export interface RotationProposal {
  changes: ProjectChange[];
  unbalanceBeforeA: number;
  unbalanceAfterA: number;
}

interface Item {
  id: string;
  maxA: number;
  /** Cluster-Ebenen, zu denen der Ladepunkt gehört. */
  clusterIds: string[];
  original: Phase;
  /** false: Ladepunkt bleibt, wie er ist. */
  movable: boolean;
}

type Assignment = Phase[];

interface Score {
  site: number;
  clusters: number;
  changes: number;
}

const EPS = 1e-9;

function better(a: Score, b: Score): boolean {
  if (Math.abs(a.site - b.site) > EPS) return a.site < b.site;
  if (Math.abs(a.clusters - b.clusters) > EPS) return a.clusters < b.clusters;
  return a.changes < b.changes;
}

function spreadOf(load: Record<Phase, number>): number {
  return Math.max(load.L1, load.L2, load.L3) - Math.min(load.L1, load.L2, load.L3);
}

function score(items: Item[], assignment: Assignment, clusterIds: string[]): Score {
  const site = { L1: 0, L2: 0, L3: 0 };
  const clusters = new Map(clusterIds.map((id) => [id, { L1: 0, L2: 0, L3: 0 }]));
  let changes = 0;
  items.forEach((item, i) => {
    const phase = assignment[i] as Phase;
    site[phase] += item.maxA;
    for (const id of item.clusterIds)
      (clusters.get(id) as Record<Phase, number>)[phase] += item.maxA;
    if (phase !== item.original) changes++;
  });
  let clusterSum = 0;
  for (const load of clusters.values()) clusterSum += spreadOf(load);
  return { site: spreadOf(site), clusters: clusterSum, changes };
}

function greedy(items: Item[]): Assignment {
  const order = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => b.item.maxA - a.item.maxA || a.i - b.i);
  const load = { L1: 0, L2: 0, L3: 0 };
  const result: Assignment = items.map((i) => i.original);
  for (const { item, i } of order) {
    if (!item.movable) {
      load[item.original] += item.maxA;
      continue;
    }
    const lowest = Math.min(load.L1, load.L2, load.L3);
    // Bei Gleichstand die bisherige Phase behalten (weniger Umbau), sonst L1 vor L2 vor L3.
    const phase: Phase =
      load[item.original] - lowest < EPS
        ? item.original
        : (PHASES.find((p) => load[p] - lowest < EPS) as Phase);
    result[i] = phase;
    load[phase] += item.maxA;
  }
  return result;
}

/**
 * Lokale Suche mit inkrementeller Bewertung: Ein Umsetzen ändert nur den Standort und die
 * Cluster des betroffenen Ladepunkts, daher bleibt sie auch bei 200 Ladepunkten schnell.
 */
function localSearch(
  items: Item[],
  start: Assignment,
  clusterIds: string[],
): { assignment: Assignment; score: Score } {
  const assignment = [...start];
  const site = { L1: 0, L2: 0, L3: 0 };
  const clusters = new Map(clusterIds.map((id) => [id, { L1: 0, L2: 0, L3: 0 }]));
  const loadOf = (id: string) => clusters.get(id) as Record<Phase, number>;
  items.forEach((item, i) => {
    const phase = assignment[i] as Phase;
    site[phase] += item.maxA;
    for (const id of item.clusterIds) loadOf(id)[phase] += item.maxA;
  });
  let best = score(items, assignment, clusterIds);

  const move = (item: Item, from: Phase, to: Phase) => {
    site[from] -= item.maxA;
    site[to] += item.maxA;
    for (const id of item.clusterIds) {
      const load = loadOf(id);
      load[from] -= item.maxA;
      load[to] += item.maxA;
    }
  };

  for (let round = 0; round < 50; round++) {
    let improved = false;
    items.forEach((item, i) => {
      if (!item.movable) return;
      const current = assignment[i] as Phase;
      const clusterBefore = item.clusterIds.reduce((sum, id) => sum + spreadOf(loadOf(id)), 0);
      for (const phase of PHASES) {
        if (phase === current) continue;
        move(item, current, phase);
        const clusterAfter = item.clusterIds.reduce((sum, id) => sum + spreadOf(loadOf(id)), 0);
        const candidate: Score = {
          site: spreadOf(site),
          clusters: best.clusters - clusterBefore + clusterAfter,
          changes:
            best.changes + (phase === item.original ? -1 : 0) + (current === item.original ? 1 : 0),
        };
        if (better(candidate, best)) {
          assignment[i] = phase;
          best = candidate;
          improved = true;
          return;
        }
        move(item, phase, current);
      }
    });
    if (!improved) break;
  }
  return { assignment, score: score(items, assignment, clusterIds) };
}

/** Ebenen, deren Mindeststrom-Summe auf einer Phase über dem verfügbaren Limit liegt. */
function minSumViolations(analysis: ProjectAnalysis): Set<string> {
  const result = new Set<string>();
  for (const level of analysis.levels) {
    const load = analysis.loadByLevel.get(level.id);
    for (const phase of PHASES) {
      if (load && load.minSum[phase] > level.available[phase] + EPS)
        result.add(`${level.id}|${phase}`);
    }
  }
  return result;
}

function solve(items: Item[], clusterIds: string[]) {
  const fromOriginal = localSearch(
    items,
    items.map((i) => i.original),
    clusterIds,
  );
  const fromGreedy = localSearch(items, greedy(items), clusterIds);
  return better(fromGreedy.score, fromOriginal.score) ? fromGreedy : fromOriginal;
}

function toChanges(project: Project, items: Item[], assignment: Assignment): ProjectChange[] {
  const changes: ProjectChange[] = [];
  project.chargePoints.forEach((cp, i) => {
    const phase = assignment[i] as Phase;
    if (phase !== items[i]?.original) {
      changes.push({
        type: 'setPhaseRotation',
        chargePointId: cp.id,
        from: cp.phaseRotation,
        to: rotationForPhase1(phase),
      });
    }
  });
  return changes;
}

export function optimizePhaseRotations(
  project: Project,
  analysis: ProjectAnalysis = analyzeProject(project),
): RotationProposal {
  const clusterIds = analysis.levels.filter((l) => l.kind === 'cluster').map((l) => l.id);
  const items: Item[] = project.chargePoints.map((cp) => ({
    id: cp.id,
    maxA: cp.maxA,
    clusterIds: (analysis.chargePoints.get(cp.id)?.levelIds ?? []).filter(
      (id) => analysis.levelById.get(id)?.kind === 'cluster',
    ),
    original: gridPhaseOf(cp.phaseRotation, 1),
    movable: true,
  }));
  const originalScore = score(
    items,
    items.map((i) => i.original),
    clusterIds,
  );

  let winner = solve(items, clusterIds);
  let changes = toChanges(project, items, winner.assignment);

  // 1-phasig angeschlossene Ladepunkte verschieben auch ihre Mindestströme.
  if (
    changes.some((c) => project.chargePoints.find((cp) => cp.id === c.chargePointId)?.phases === 1)
  ) {
    const before = minSumViolations(analysis);
    const after = minSumViolations(analyzeProject(applyChanges(project, changes)));
    if ([...after].some((key) => !before.has(key))) {
      project.chargePoints.forEach((cp, i) => {
        if (cp.phases === 1) (items[i] as Item).movable = false;
      });
      winner = solve(items, clusterIds);
      changes = toChanges(project, items, winner.assignment);
    }
  }

  return {
    changes,
    unbalanceBeforeA: originalScore.site,
    unbalanceAfterA: winner.score.site,
  };
}
