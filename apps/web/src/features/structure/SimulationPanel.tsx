import {
  analyzeProject,
  formatA,
  formatKw,
  loadedPhases,
  minPhase,
  phaseValues,
  PHASES,
  simulateAllocation,
  type Project,
  type SimulationResult,
} from '@lastplan/core';
import { NumberField, SelectField, StatusBadge } from '@lastplan/ui';
import { useMemo, useState } from 'react';
import { useProjectStore } from '../../state/projectStore';

/** Simulation „N Fahrzeuge laden“ (Kap. 4.5): reine Vorschau der Stromverteilung. */

export interface LevelUsage {
  id: string;
  name: string;
  usedA: number;
  limitA: number;
}

/** Strom je Ebene aus dem Simulationsergebnis (ungünstigste Phase gegen das wirksame Limit). */
export function levelUsage(
  project: Project,
  result: SimulationResult,
  vehiclePhases: 1 | 3,
): LevelUsage[] {
  const analysis = analyzeProject(project);
  const alloc = new Map(result.allocations.map((a) => [a.chargePointId, a]));
  return analysis.levels
    .filter((l) => l.chargePointIds.length > 0)
    .map((level) => {
      const used = phaseValues(0);
      for (const cpId of level.chargePointIds) {
        const cp = project.chargePoints.find((c) => c.id === cpId);
        const a = alloc.get(cpId);
        if (!cp || !a) continue;
        for (const ph of loadedPhases(cp, vehiclePhases)) used[ph] += a.currentA;
      }
      return {
        id: level.id,
        name: level.name,
        usedA: Math.max(...PHASES.map((p) => used[p])),
        limitA: minPhase(level.available),
      };
    });
}

export function SimulationPanel() {
  const project = useProjectStore((s) => s.project);
  const [count, setCount] = useState('');
  const [phases, setPhases] = useState<'3' | '1'>('3');
  const total = project?.chargePoints.length ?? 0;
  const parsed = count.trim() === '' ? total : Number(count);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= total;
  const n = valid ? parsed : 0;

  const view = useMemo(() => {
    if (!project || !valid) return null;
    const vehiclePhases = phases === '1' ? 1 : 3;
    const result = simulateAllocation(project, { vehicleCount: n, vehiclePhases });
    return { result, levels: levelUsage(project, result, vehiclePhases) };
  }, [project, n, valid, phases]);

  if (!project) return null;
  return (
    <div className="structure-sim">
      <NumberField
        label="Anzahl ladender Fahrzeuge"
        unit="Fahrzeuge"
        value={count}
        placeholder={String(total)}
        min={0}
        max={total}
        step={1}
        onChange={(e) => setCount(e.target.value)}
        {...(!valid ? { error: `Bitte eine ganze Zahl von 0 bis ${total} eingeben` } : {})}
        hint={valid ? 'Es laden die ersten Ladepunkte in der Reihenfolge der Anlage.' : ''}
      />
      <SelectField
        label="Fahrzeuge laden"
        value={phases}
        onChange={(e) => setPhases(e.target.value === '1' ? '1' : '3')}
      >
        <option value="3">3-phasig</option>
        <option value="1">1-phasig (alle auf Phase 1 des Fahrzeugs)</option>
      </SelectField>
      {view ? (
        <div aria-live="polite">
          <p className="structure-sim__head">
            {n} {n === 1 ? 'Fahrzeug lädt' : 'Fahrzeuge laden'}:{' '}
            {formatKw(view.result.totalPowerKw)}
            {view.result.pausedCount > 0 ? `, ${view.result.pausedCount} pausiert` : ''}
          </p>
          <h4 className="structure-sim__sub">Je Ebene</h4>
          <ul className="structure-sim__list">
            {view.levels.map((l) => (
              <li key={l.id}>
                <span>{l.name}</span>
                <span className="structure-num">
                  {formatA(l.usedA)} von {formatA(l.limitA)}
                </span>
              </li>
            ))}
          </ul>
          <h4 className="structure-sim__sub">Je Ladepunkt</h4>
          <ul className="structure-sim__list">
            {view.result.allocations
              .filter((a) => a.active)
              .map((a) => (
                <li key={a.chargePointId}>
                  <span>{a.label}</span>
                  <span className="structure-num">
                    {a.paused ? (
                      <StatusBadge status="warning">pausiert</StatusBadge>
                    ) : (
                      formatA(a.currentA)
                    )}
                    {a.limitedBy && a.limitedBy.kind !== 'chargePoint'
                      ? ` · begrenzt: ${a.limitedBy.name}`
                      : ''}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
