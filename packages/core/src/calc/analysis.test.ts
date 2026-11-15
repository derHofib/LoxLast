import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { projectArbitrary } from '../__tests__/arbitraries';
import { makeChargePoint, makeCluster, makeGroup, makeSampleProject } from '../__tests__/fixtures';
import { SITE_LEVEL_ID, analyzeProject, siteAvailableA } from './analysis';
import { PHASES, phaseValues } from './phases';

/**
 * Beispielanlage (fixtures.ts): Netzanschluss 250 A, Reserve 80 A → 170 A.
 * UV-TG1 125 A; Gruppe Mieter (Prio 2): LP01 3-ph L1-L2-L3, LP02 3-ph L2-L3-L1;
 * Gruppe Flotte (Prio 1, max 63 A): LP03 1-ph L1-L2-L3. Alle 6–16 A.
 */
describe('analyzeProject – Beispielanlage', () => {
  const project = makeSampleProject();
  const [cluster] = project.clusters;
  const [tenants, fleet] = project.groups;
  const a = analyzeProject(project);

  it('verfügbare Limits je Ebene (Kap. 4.1)', () => {
    expect(a.siteAvailableA).toBe(170);
    expect(a.levelById.get(SITE_LEVEL_ID)?.available).toEqual(phaseValues(170));
    expect(a.levelById.get(cluster?.id ?? '')?.available).toEqual(phaseValues(125));
    expect(a.levelById.get(fleet?.id ?? '')?.available).toEqual(phaseValues(63));
    expect(a.levelById.get(tenants?.id ?? '')?.available).toEqual(phaseValues(125));
    expect(a.levelById.get(fleet?.id ?? '')?.name).toBe('UV-TG1 · Ebene −1 › Flotte');
  });

  it('Worst-Case-Phasenlast (Kap. 4.3)', () => {
    const site = a.loadByLevel.get(SITE_LEVEL_ID);
    expect(site?.allThreePhase).toEqual(phaseValues(48, 32, 32));
    expect(site?.allSinglePhase).toEqual(phaseValues(32, 16, 0));
    expect(site?.worstCase).toEqual(phaseValues(48, 32, 32));
    expect(site?.unbalanceA).toBe(32);
  });

  it('Mindeststrom-Summe je Phase (Kap. 4.4)', () => {
    expect(a.loadByLevel.get(SITE_LEVEL_ID)?.minSum).toEqual(phaseValues(18, 12, 12));
    expect(a.loadByLevel.get(fleet?.id ?? '')?.minSum).toEqual(phaseValues(6, 0, 0));
  });

  it('Ebenen-Kette je Ladepunkt', () => {
    const lp03 = project.chargePoints[2];
    expect(a.chargePoints.get(lp03?.id ?? '')?.levelIds).toEqual([
      fleet?.id,
      cluster?.id,
      SITE_LEVEL_ID,
    ]);
  });
});

describe('analyzeProject – Sonderfälle', () => {
  it('Gebäudereserve über Netzanschluss ergibt 0 A', () => {
    const p = makeSampleProject();
    expect(siteAvailableA({ ...p, site: { ...p.site, buildingReserveA: 300 } })).toBe(0);
  });

  it('verschachtelte Cluster: min(eigenes Limit, Elternebene), auch je Phase', () => {
    const p = makeSampleProject();
    const root = makeCluster({ name: 'HV', limitA: 100, phaseLimitA: [100, 80, 100] });
    const child = makeCluster({ name: 'UV', limitA: 125, parentClusterId: root.id });
    p.clusters = [child, root]; // Reihenfolge egal
    const a = analyzeProject(p);
    expect(a.levelById.get(root.id)?.available).toEqual(phaseValues(100, 80, 100));
    expect(a.levelById.get(child.id)?.available).toEqual(phaseValues(100, 80, 100));
    expect(a.levelById.get(child.id)?.parentId).toBe(root.id);
  });

  it('Gruppen-Mindeststrom überschreibt den des Ladepunkts', () => {
    const p = makeSampleProject();
    const fleet = p.groups[1];
    if (!fleet) throw new Error('Fixture');
    fleet.minPerChargePointA = 10;
    const a = analyzeProject(p);
    expect(a.chargePoints.get(p.chargePoints[2]?.id ?? '')?.effectiveMinA).toBe(10);
    expect(a.loadByLevel.get(SITE_LEVEL_ID)?.minSum).toEqual(phaseValues(22, 12, 12));
  });

  it('fehlerhafte Struktur: Last zählt trotzdem am Standort, Zyklen hängen am Standort', () => {
    const p = makeSampleProject();
    const a1 = makeCluster({ name: 'A' });
    const b1 = makeCluster({ name: 'B', parentClusterId: a1.id });
    a1.parentClusterId = b1.id;
    const orphanCluster = makeCluster({
      name: 'Waise',
      parentClusterId: '0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    });
    const orphanGroup = makeGroup('0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c', { name: 'ohne Cluster' });
    p.clusters.push(a1, b1, orphanCluster);
    p.groups.push(orphanGroup);
    p.chargePoints.push(
      makeChargePoint(orphanGroup.id, {
        label: 'LP10',
        network: { ip: '192.168.10.30', port: 502 },
      }),
      makeChargePoint('0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d', {
        label: 'LP11',
        network: { ip: '192.168.10.31', port: 502 },
      }),
    );
    const a = analyzeProject(p);
    expect(a.levelById.get(a1.id)?.parentId).toBe(SITE_LEVEL_ID);
    expect(a.levelById.get(b1.id)?.parentId).toBe(SITE_LEVEL_ID);
    expect(a.levelById.get(orphanCluster.id)?.parentId).toBe(SITE_LEVEL_ID);
    expect(a.levelById.has(orphanGroup.id)).toBe(false);
    expect(a.levelById.get(SITE_LEVEL_ID)?.chargePointIds).toHaveLength(5);
    expect(a.loadByLevel.get(SITE_LEVEL_ID)?.allThreePhase).toEqual(phaseValues(80, 64, 64));
  });
});

describe('analyzeProject – Eigenschaften', () => {
  it('Standort trägt mindestens die Last jeder Unterebene; Worst Case ≥ beide Szenarien', () => {
    fc.assert(
      fc.property(projectArbitrary, (project) => {
        const a = analyzeProject(project);
        const site = a.loadByLevel.get(SITE_LEVEL_ID);
        if (!site) throw new Error('Standort fehlt');
        for (const level of a.levels) {
          const load = a.loadByLevel.get(level.id);
          if (!load) throw new Error('Last fehlt');
          for (const p of PHASES) {
            expect(load.worstCase[p]).toBeGreaterThanOrEqual(load.allThreePhase[p]);
            expect(load.worstCase[p]).toBeGreaterThanOrEqual(load.allSinglePhase[p]);
            expect(site.worstCase[p]).toBeGreaterThanOrEqual(load.worstCase[p] - 1e-9);
            expect(site.minSum[p]).toBeGreaterThanOrEqual(load.minSum[p] - 1e-9);
            // verfügbares Limit nie größer als das der Elternebene
            const parent = level.parentId ? a.levelById.get(level.parentId) : undefined;
            if (parent) expect(level.available[p]).toBeLessThanOrEqual(parent.available[p]);
          }
        }
        // Szenario B verteilt dieselbe Summe wie die Max-Ströme aller Ladepunkte
        const total = project.chargePoints.reduce((s, cp) => s + cp.maxA, 0);
        expect(
          site.allSinglePhase.L1 + site.allSinglePhase.L2 + site.allSinglePhase.L3,
        ).toBeCloseTo(total, 9);
      }),
    );
  });
});
