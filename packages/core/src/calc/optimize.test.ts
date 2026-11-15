import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { projectArbitrary } from '../__tests__/arbitraries';
import { makeSampleProject } from '../__tests__/fixtures';
import { SITE_LEVEL_ID, analyzeProject } from './analysis';
import { applyChanges } from './changes';
import { optimizePhaseRotations } from './optimize';

describe('optimizePhaseRotations', () => {
  it('Beispielanlage: ein Ladepunkt von L1 auf L3 → Schieflast 0', () => {
    const project = makeSampleProject();
    const result = optimizePhaseRotations(project);
    expect(result).toMatchObject({ unbalanceBeforeA: 32, unbalanceAfterA: 0 });
    expect(result.changes).toEqual([
      expect.objectContaining({ type: 'setPhaseRotation', from: 'L1-L2-L3', to: 'L3-L1-L2' }),
    ]);
  });

  it('verschiebt keinen 1-phasigen Ladepunkt, wenn dadurch Mindestströme nicht mehr passen', () => {
    // L3 im Cluster nur 10 A: LP03 (1-phasig, 6 A Minimum) darf nicht von L1 auf L3 wandern,
    // weil LP01/LP02 dort schon 12 A Mindeststrom brauchen.
    const project = makeSampleProject();
    Object.assign(project.clusters[0] ?? {}, { phaseLimitA: [125, 125, 10] });
    const lp03 = project.chargePoints[2];
    const result = optimizePhaseRotations(project);
    expect(result.changes.map((c) => c.chargePointId)).not.toContain(lp03?.id);
    expect(result.unbalanceAfterA).toBeLessThan(result.unbalanceBeforeA);
  });

  it('ausgeglichene Anlage bleibt unverändert', () => {
    const project = makeSampleProject();
    Object.assign(project.chargePoints[2] ?? {}, { phaseRotation: 'L3-L1-L2' });
    expect(optimizePhaseRotations(project).changes).toEqual([]);
  });

  it('leere Anlage', () => {
    expect(optimizePhaseRotations({ ...makeSampleProject(), chargePoints: [] })).toEqual({
      changes: [],
      unbalanceBeforeA: 0,
      unbalanceAfterA: 0,
    });
  });

  it('bevorzugt bei gleicher Standort-Schieflast ausgeglichene Cluster', () => {
    // Zwei Cluster mit je zwei Ladepunkten auf L1: Standort- und Cluster-Schieflast sollen sinken.
    const project = makeSampleProject();
    const [lp01, lp02, lp03] = project.chargePoints;
    if (!lp01 || !lp02 || !lp03) throw new Error('Fixture');
    for (const cp of [lp01, lp02, lp03]) cp.phaseRotation = 'L1-L2-L3';
    const result = optimizePhaseRotations(project);
    const after = analyzeProject(applyChanges(project, result.changes));
    expect(after.loadByLevel.get(SITE_LEVEL_ID)?.unbalanceA).toBe(0);
    expect(result.changes).toHaveLength(2);
  });

  it('Eigenschaften: nie schlechter, höchstens größter Einzelstrom, keine neue Mindeststrom-Überschreitung', () => {
    fc.assert(
      fc.property(projectArbitrary, (project) => {
        const before = analyzeProject(project);
        const result = optimizePhaseRotations(project, before);
        const after = analyzeProject(applyChanges(project, result.changes));
        const siteBefore = before.loadByLevel.get(SITE_LEVEL_ID);
        const siteAfter = after.loadByLevel.get(SITE_LEVEL_ID);
        if (!siteBefore || !siteAfter) throw new Error('Standort fehlt');

        expect(result.unbalanceBeforeA).toBeCloseTo(siteBefore.unbalanceA, 9);
        expect(result.unbalanceAfterA).toBeCloseTo(siteAfter.unbalanceA, 9);
        expect(siteAfter.unbalanceA).toBeLessThanOrEqual(siteBefore.unbalanceA + 1e-9);
        const largest = Math.max(0, ...project.chargePoints.map((cp) => cp.maxA));
        // Schranke des Greedy-Verfahrens; gilt sicher, wenn alle Ladepunkte verschiebbar sind
        if (project.chargePoints.every((cp) => cp.phases === 3)) {
          expect(siteAfter.unbalanceA).toBeLessThanOrEqual(largest + 1e-9);
        }
        // Gesamtlast bleibt gleich, nur die Verteilung auf die Phasen ändert sich
        const sum = (v: { L1: number; L2: number; L3: number }) => v.L1 + v.L2 + v.L3;
        expect(sum(siteAfter.allThreePhase)).toBeCloseTo(sum(siteBefore.allThreePhase), 9);
        for (const level of after.levels) {
          const minBefore = before.loadByLevel.get(level.id)?.minSum;
          const minAfter = after.loadByLevel.get(level.id)?.minSum;
          for (const ph of ['L1', 'L2', 'L3'] as const) {
            const wasOk = (minBefore?.[ph] ?? 0) <= level.available[ph] + 1e-9;
            if (wasOk) expect(minAfter?.[ph] ?? 0).toBeLessThanOrEqual(level.available[ph] + 1e-9);
          }
        }
        for (const change of result.changes) expect(change.from).not.toBe(change.to);
      }),
      { numRuns: 200 },
    );
  });
});

describe('applyChanges', () => {
  it('ändert nur die betroffenen Ladepunkte und lässt das Original unberührt', () => {
    const project = makeSampleProject();
    const lp02 = project.chargePoints[1];
    if (!lp02) throw new Error('Fixture');
    const next = applyChanges(project, [
      { type: 'setPhaseRotation', chargePointId: lp02.id, from: 'L2-L3-L1', to: 'L3-L1-L2' },
    ]);
    expect(next.chargePoints[1]?.phaseRotation).toBe('L3-L1-L2');
    expect(next.chargePoints[0]).toBe(project.chargePoints[0]);
    expect(lp02.phaseRotation).toBe('L2-L3-L1');
    expect(applyChanges(project, [])).toBe(project);
  });
});
