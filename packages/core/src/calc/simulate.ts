import type { Project } from '../model';
import { SITE_LEVEL_ID, analyzeProject, type LevelKind, type ProjectAnalysis } from './analysis';
import { PHASES, loadedPhases, phaseValues, type Phase, type PhaseValues } from './phases';
import { kwFromA } from './units';

/**
 * Vorschau der Stromverteilung „Was passiert, wenn N Fahrzeuge laden?“ (Kap. 4.5).
 * Dient nur der Plausibilisierung – die echte Regelung macht der Miniserver.
 *
 * 1. Allen aktiven Ladepunkten den Mindeststrom zuteilen. Passt das nicht in ein Limit,
 *    werden im betroffenen Bereich Ladepunkte niedrigster Priorität pausiert, bis es passt.
 * 2. Restkapazität nach Priorität verteilen (1 zuerst), innerhalb gleicher Priorität in gleichen
 *    Schritten, gedeckelt durch maxA sowie Gruppen-, Cluster- und Standort-Limits je Phase.
 */

export interface SimulationScenario {
  /** Ladende Ladepunkte. Ohne Angabe: die ersten `vehicleCount` in Projektreihenfolge bzw. alle. */
  activeChargePointIds?: readonly string[];
  vehicleCount?: number;
  /** Wie die Fahrzeuge laden: 3-phasig (Standard) oder alle 1-phasig. */
  vehiclePhases?: 1 | 3;
}

export type LimitingFactor =
  { kind: 'chargePoint' } | { kind: LevelKind; levelId: string; name: string };

export interface ChargePointAllocation {
  chargePointId: string;
  label: string;
  currentA: number;
  paused: boolean;
  /** Was die Zuteilung begrenzt; fehlt bei nicht ladenden Ladepunkten. */
  limitedBy?: LimitingFactor;
  active: boolean;
}

export interface SimulationResult {
  allocations: ChargePointAllocation[];
  /** Belastung je Phase am Standort. */
  siteLoad: PhaseValues;
  totalPowerKw: number;
  pausedCount: number;
}

const EPS = 1e-9;

interface Constraint {
  levelId: string;
  limit: PhaseValues;
  used: PhaseValues;
}

interface Participant {
  id: string;
  label: string;
  priority: number;
  order: number;
  minA: number;
  maxA: number;
  phases: readonly Phase[];
  constraints: Constraint[];
  currentA: number;
  paused: boolean;
  limitedBy?: LimitingFactor;
}

function levelFactor(analysis: ProjectAnalysis, levelId: string): LimitingFactor {
  const level = analysis.levelById.get(levelId);
  return level
    ? { kind: level.kind, levelId, name: level.name }
    : { kind: 'site', levelId: SITE_LEVEL_ID, name: 'Standort' };
}

export function simulateAllocation(
  project: Project,
  scenario: SimulationScenario = {},
  analysis: ProjectAnalysis = analyzeProject(project),
): SimulationResult {
  const vehiclePhases = scenario.vehiclePhases ?? 3;
  const activeIds = new Set(
    scenario.activeChargePointIds ??
      project.chargePoints
        .slice(0, scenario.vehicleCount ?? project.chargePoints.length)
        .map((cp) => cp.id),
  );

  // Je Ebene mit endlichem Limit eine Nebenbedingung.
  const constraints = new Map<string, Constraint>();
  for (const level of analysis.levels) {
    if (PHASES.every((p) => !Number.isFinite(level.ownLimit[p]))) continue;
    constraints.set(level.id, { levelId: level.id, limit: level.ownLimit, used: phaseValues(0) });
  }

  const participants: Participant[] = [];
  project.chargePoints.forEach((cp, order) => {
    if (!activeIds.has(cp.id)) return;
    const info = analysis.chargePoints.get(cp.id);
    if (!info) return;
    participants.push({
      id: cp.id,
      label: cp.label,
      priority: info.group?.priority ?? 5,
      order,
      minA: info.effectiveMinA,
      maxA: Math.max(cp.maxA, info.effectiveMinA),
      phases: loadedPhases(cp, vehiclePhases),
      // von unten nach oben: Gruppe, Cluster, Standort
      constraints: info.levelIds.flatMap((id) => {
        const c = constraints.get(id);
        return c ? [c] : [];
      }),
      currentA: 0,
      paused: false,
    });
  });

  const add = (p: Participant, amount: number) => {
    p.currentA += amount;
    for (const c of p.constraints) for (const ph of p.phases) c.used[ph] += amount;
  };

  // Schritt 1: Mindestströme, bei Überlast niedrigste Priorität pausieren.
  for (const p of participants) add(p, p.minA);
  for (;;) {
    const violated = [...constraints.values()].flatMap((c) =>
      PHASES.filter((ph) => c.used[ph] > c.limit[ph] + EPS).map((ph) => ({ c, ph })),
    );
    if (violated.length === 0) break;
    const candidates = participants.filter(
      (p) =>
        !p.paused &&
        violated.some(({ c, ph }) => p.constraints.includes(c) && p.phases.includes(ph)),
    );
    // Niedrigste Priorität (größte Zahl) zuerst, bei Gleichstand der zuletzt angelegte.
    const victim = candidates.sort((a, b) => b.priority - a.priority || b.order - a.order)[0];
    if (!victim) break; // nicht erreichbar: jede Überlast stammt von einem aktiven Ladepunkt
    const cause = violated.find(({ c }) => victim.constraints.includes(c));
    add(victim, -victim.currentA);
    victim.paused = true;
    if (cause) victim.limitedBy = levelFactor(analysis, cause.c.levelId);
  }

  // Schritt 2: Restkapazität nach Priorität in gleichen Schritten verteilen.
  for (let priority = 1; priority <= 5; priority++) {
    let open = participants.filter((p) => !p.paused && p.priority === priority);
    while (open.length > 0) {
      let step = Math.min(...open.map((p) => p.maxA - p.currentA));
      for (const c of constraints.values()) {
        for (const ph of PHASES) {
          const sharing = open.filter(
            (p) => p.constraints.includes(c) && p.phases.includes(ph),
          ).length;
          if (sharing > 0) step = Math.min(step, (c.limit[ph] - c.used[ph]) / sharing);
        }
      }
      step = Math.max(step, 0);
      for (const p of open) add(p, step);

      open = open.filter((p) => {
        if (p.maxA - p.currentA <= EPS) {
          p.limitedBy = { kind: 'chargePoint' };
          return false;
        }
        const tight = p.constraints.find((c) =>
          p.phases.some((ph) => c.limit[ph] - c.used[ph] <= EPS),
        );
        if (tight) {
          p.limitedBy = levelFactor(analysis, tight.levelId);
          return false;
        }
        return true;
      });
    }
  }

  const byId = new Map(participants.map((p) => [p.id, p]));
  const siteLoad = phaseValues(0);
  let totalPowerKw = 0;
  const allocations = project.chargePoints.map((cp): ChargePointAllocation => {
    const p = byId.get(cp.id);
    if (!p)
      return { chargePointId: cp.id, label: cp.label, currentA: 0, paused: false, active: false };
    for (const ph of p.phases) siteLoad[ph] += p.currentA;
    totalPowerKw += kwFromA(p.currentA, p.phases.length === 3 ? 3 : 1, project.settings.voltageV);
    return {
      chargePointId: cp.id,
      label: cp.label,
      currentA: p.currentA,
      paused: p.paused,
      active: true,
      ...(p.limitedBy ? { limitedBy: p.limitedBy } : {}),
    };
  });

  return {
    allocations,
    siteLoad,
    totalPowerKw,
    pausedCount: participants.filter((p) => p.paused).length,
  };
}
