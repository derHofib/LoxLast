import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { projectArbitrary } from '../__tests__/arbitraries';
import { makeSampleProject } from '../__tests__/fixtures';
import { analyzeProject } from './analysis';
import { PHASES, loadedPhases, phaseValues } from './phases';
import { simulateAllocation } from './simulate';

const summary = (r: ReturnType<typeof simulateAllocation>) =>
  r.allocations.map((a) => [
    a.label,
    Math.round(a.currentA * 1000) / 1000,
    a.paused,
    a.limitedBy?.kind ?? null,
  ]);

function withClusterLimit(limitA: number) {
  const p = makeSampleProject();
  Object.assign(p.clusters[0] ?? {}, { limitA });
  return p;
}

describe('simulateAllocation (Kap. 4.5)', () => {
  it('genug Kapazität: alle laden mit Max-Strom', () => {
    const r = simulateAllocation(makeSampleProject());
    expect(summary(r)).toEqual([
      ['LP01', 16, false, 'chargePoint'],
      ['LP02', 16, false, 'chargePoint'],
      ['LP03', 16, false, 'chargePoint'],
    ]);
    expect(r.siteLoad).toEqual(phaseValues(48, 32, 32));
    expect(r.totalPowerKw).toBeCloseTo(25.76, 9);
    expect(r.pausedCount).toBe(0);
  });

  it('knappes Cluster-Limit: Priorität 1 bekommt den Rest, Priorität 2 bleibt auf Minimum', () => {
    // Cluster 20 A: Mindestströme L1 = 18 A, Rest 2 A geht an LP03 (Flotte, Prio 1)
    const r = simulateAllocation(withClusterLimit(20));
    expect(summary(r)).toEqual([
      ['LP01', 6, false, 'cluster'],
      ['LP02', 6, false, 'cluster'],
      ['LP03', 8, false, 'cluster'],
    ]);
    expect(r.allocations[2]?.limitedBy).toMatchObject({
      kind: 'cluster',
      name: 'UV-TG1 · Ebene −1',
    });
  });

  it('Mindestströme passen nicht: niedrigste Priorität, zuletzt angelegt, wird pausiert', () => {
    const r = simulateAllocation(withClusterLimit(15));
    expect(summary(r)).toEqual([
      ['LP01', 6, false, 'cluster'],
      ['LP02', 0, true, 'cluster'],
      ['LP03', 9, false, 'cluster'],
    ]);
    expect(r.pausedCount).toBe(1);
  });

  it('Gruppen-Limit begrenzt', () => {
    const p = makeSampleProject();
    Object.assign(p.groups[1] ?? {}, { maxA: 10 });
    const r = simulateAllocation(p);
    expect(r.allocations[2]).toMatchObject({
      currentA: 10,
      limitedBy: { kind: 'group', name: 'UV-TG1 · Ebene −1 › Flotte' },
    });
  });

  it('N Fahrzeuge: nur die ersten N laden', () => {
    const r = simulateAllocation(makeSampleProject(), { vehicleCount: 1 });
    expect(r.allocations.map((a) => [a.label, a.active, a.currentA])).toEqual([
      ['LP01', true, 16],
      ['LP02', false, 0],
      ['LP03', false, 0],
    ]);
  });

  it('ausgewählte Ladepunkte und 1-phasig ladende Fahrzeuge', () => {
    const p = makeSampleProject();
    const r = simulateAllocation(p, {
      activeChargePointIds: [p.chargePoints[1]?.id ?? '', p.chargePoints[2]?.id ?? ''],
      vehiclePhases: 1,
    });
    expect(r.siteLoad).toEqual(phaseValues(16, 16, 0));
    expect(r.totalPowerKw).toBeCloseTo(7.36, 9);
  });

  it('Standort ohne verfügbare Leistung: alle pausiert', () => {
    const p = makeSampleProject();
    p.site.buildingReserveA = 250;
    const r = simulateAllocation(p);
    expect(r.pausedCount).toBe(3);
    expect(r.allocations.every((a) => a.currentA === 0 && a.limitedBy?.kind === 'site')).toBe(true);
  });

  it('Eigenschaften: Limits eingehalten, Ströme zwischen Min und Max, Pausierte bei 0', () => {
    fc.assert(
      fc.property(projectArbitrary, fc.constantFrom<1 | 3>(1, 3), (project, vehiclePhases) => {
        const analysis = analyzeProject(project);
        const r = simulateAllocation(project, { vehiclePhases }, analysis);
        const byId = new Map(project.chargePoints.map((cp) => [cp.id, cp]));
        const usage = new Map(analysis.levels.map((l) => [l.id, phaseValues(0)]));
        for (const a of r.allocations) {
          const cp = byId.get(a.chargePointId);
          const info = analysis.chargePoints.get(a.chargePointId);
          if (!cp || !info) throw new Error('Ladepunkt fehlt');
          if (a.paused) {
            expect(a.currentA).toBe(0);
            continue;
          }
          expect(a.currentA).toBeGreaterThanOrEqual(info.effectiveMinA - 1e-9);
          expect(a.currentA).toBeLessThanOrEqual(Math.max(cp.maxA, info.effectiveMinA) + 1e-9);
          for (const id of info.levelIds) {
            for (const ph of loadedPhases(cp, vehiclePhases))
              (usage.get(id) ?? phaseValues(0))[ph] += a.currentA;
          }
        }
        for (const level of analysis.levels) {
          for (const ph of PHASES) {
            expect(usage.get(level.id)?.[ph] ?? 0).toBeLessThanOrEqual(level.ownLimit[ph] + 1e-6);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
