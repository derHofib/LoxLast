import type { Level } from '../../calc/analysis';
import { PHASES, type Phase, type PhaseValues } from '../../calc/phases';

const EPS = 1e-9;

export interface Exceedance {
  phases: Phase[];
  /** Phase mit der größten Überschreitung. */
  worst: Phase;
  value: number;
  limit: number;
}

/** Phasen, auf denen `values` das verfügbare Limit überschreitet. */
export function exceedance(values: PhaseValues, limit: PhaseValues): Exceedance | undefined {
  const phases = PHASES.filter((p) => values[p] > limit[p] + EPS);
  if (phases.length === 0) return undefined;
  const worst = phases.reduce((a, b) => (values[b] - limit[b] > values[a] - limit[a] ? b : a));
  return { phases, worst, value: values[worst], limit: limit[worst] };
}

/** Alle drei Phasen gleich (Wert und Limit) → Phasenangabe in der Meldung überflüssig. */
export function symmetric(values: PhaseValues, limit: PhaseValues): boolean {
  return (
    values.L1 === values.L2 &&
    values.L2 === values.L3 &&
    limit.L1 === limit.L2 &&
    limit.L2 === limit.L3
  );
}

/** Ebenen, die eigenständig geprüft werden: Standort, Cluster, Gruppen mit eigenem Limit. */
export function checkedLevels(levels: readonly Level[]): Level[] {
  return levels.filter((l) => l.kind !== 'group' || Number.isFinite(l.ownLimit.L1));
}

/** Ziel-IDs einer Ebene für den Sprung in der UI. */
export const levelTarget = (level: Level) => [level.id];
