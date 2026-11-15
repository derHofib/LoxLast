import fc from 'fast-check';
import type { ChargePoint, Cluster, Group, Project } from '../model';
import { PHASE_ROTATIONS } from '../model';
import { makeSampleProject } from './fixtures';

/** IDs im UUID-v7-Format, deterministisch aus einem Präfix und Index. */
const id = (prefix: number, i: number) =>
  `0196a1b2-c3d4-7e5f-8a9b-${prefix.toString(16).padStart(4, '0')}${i.toString(16).padStart(8, '0')}`;

/**
 * Zufällige, strukturell gültige Anlage: verschachtelte Cluster, Gruppen, Ladepunkte.
 * Für Property-based Tests der Berechnung, Simulation und Optimierung.
 */
export const projectArbitrary: fc.Arbitrary<Project> = fc
  .record({
    fuse: fc.integer({ min: 35, max: 400 }),
    reserve: fc.integer({ min: 0, max: 100 }),
    clusters: fc.array(
      fc.record({
        limitA: fc.integer({ min: 16, max: 250 }),
        parentPick: fc.nat(),
        phaseLimits: fc.option(
          fc.tuple(
            fc.integer({ min: 16, max: 250 }),
            fc.integer({ min: 16, max: 250 }),
            fc.integer({ min: 16, max: 250 }),
          ),
          { nil: undefined },
        ),
      }),
      { minLength: 1, maxLength: 4 },
    ),
    groups: fc.array(
      fc.record({
        clusterPick: fc.nat(),
        priority: fc.constantFrom(1, 2, 3, 4, 5),
        maxA: fc.option(fc.integer({ min: 6, max: 200 }), { nil: undefined }),
        minOverride: fc.option(fc.integer({ min: 6, max: 10 }), { nil: undefined }),
      }),
      { minLength: 1, maxLength: 6 },
    ),
    chargePoints: fc.array(
      fc.record({
        groupPick: fc.nat(),
        minA: fc.integer({ min: 6, max: 10 }),
        extraMax: fc.integer({ min: 0, max: 22 }),
        phases: fc.constantFrom<1 | 3>(1, 3),
        rotation: fc.constantFrom(...PHASE_ROTATIONS),
      }),
      { maxLength: 30 },
    ),
  })
  .map(({ fuse, reserve, clusters, groups, chargePoints }) => {
    const base = makeSampleProject();
    const clusterList: Cluster[] = clusters.map((c, i) => {
      // Eltern nur aus früheren Clustern → keine Zyklen
      const parentIndex = i === 0 ? -1 : (c.parentPick % (i + 1)) - 1;
      return {
        id: id(1, i),
        name: `UV-${i + 1}`,
        limitA: c.limitA,
        ...(parentIndex >= 0 ? { parentClusterId: id(1, parentIndex) } : {}),
        ...(c.phaseLimits ? { phaseLimitA: c.phaseLimits } : {}),
      };
    });
    const groupList: Group[] = groups.map((g, i) => ({
      id: id(2, i),
      name: `Gruppe ${i + 1}`,
      clusterId: id(1, g.clusterPick % clusterList.length),
      priority: g.priority,
      ...(g.maxA !== undefined ? { maxA: g.maxA } : {}),
      ...(g.minOverride !== undefined ? { minPerChargePointA: g.minOverride } : {}),
    }));
    const cpList: ChargePoint[] = chargePoints.map((cp, i) => ({
      id: id(3, i),
      label: `LP${String(i + 1).padStart(2, '0')}`,
      groupId: id(2, cp.groupPick % groupList.length),
      libraryModelId: 'test/wallbox@1',
      network: { ip: `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`, port: 502, unitId: 1 },
      protocol: 'modbus-tcp',
      fuseA: 32,
      minA: cp.minA,
      maxA: cp.minA + cp.extraMax,
      phases: cp.phases,
      phaseRotation: cp.rotation,
      phaseSwitching: false,
    }));
    return {
      ...base,
      site: { ...base.site, gridConnectionFuseA: fuse, buildingReserveA: reserve },
      clusters: clusterList,
      groups: groupList,
      chargePoints: cpList,
    };
  });

/** Große Anlage für Performance-Tests: 10 Cluster, 30 Gruppen, `count` Ladepunkte. */
export function makeLargeProject(count = 200): Project {
  const base = makeSampleProject();
  const clusters: Cluster[] = Array.from({ length: 10 }, (_, i) => ({
    id: id(1, i),
    name: `UV-${i + 1}`,
    limitA: 125,
    ...(i >= 5 ? { parentClusterId: id(1, i - 5) } : {}),
  }));
  const groups: Group[] = Array.from({ length: 30 }, (_, i) => ({
    id: id(2, i),
    name: `Gruppe ${i + 1}`,
    clusterId: id(1, i % 10),
    priority: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
    ...(i % 3 === 0 ? { maxA: 63 } : {}),
  }));
  const chargePoints: ChargePoint[] = Array.from({ length: count }, (_, i) => ({
    id: id(3, i),
    label: `LP${String(i + 1).padStart(3, '0')}`,
    groupId: id(2, i % 30),
    libraryModelId: 'test/wallbox@1',
    network: { ip: `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`, port: 502, unitId: 1 },
    protocol: 'modbus-tcp',
    fuseA: 32,
    minA: 6,
    maxA: i % 4 === 0 ? 16 : 32,
    phases: i % 7 === 0 ? 1 : 3,
    // absichtlich unausgewogen, damit die Schieflast-Optimierung mitläuft
    phaseRotation: i % 5 === 0 ? 'L2-L3-L1' : 'L1-L2-L3',
    phaseSwitching: false,
  }));
  return {
    ...base,
    site: { ...base.site, gridConnectionFuseA: 630, buildingReserveA: 100 },
    clusters,
    groups,
    chargePoints,
  };
}
