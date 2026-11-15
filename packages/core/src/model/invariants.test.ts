import { describe, expect, it } from 'vitest';
import { makeChargePoint, makeCluster, makeGroup, makeSampleProject } from '../__tests__/fixtures';
import { StrictProjectSchema, checkProjectInvariants } from './invariants';
import type { Project } from './project';

const codes = (p: Project) => checkProjectInvariants(p).map((i) => i.code);

describe('checkProjectInvariants', () => {
  it('Beispielanlage ist widerspruchsfrei', () =>
    expect(checkProjectInvariants(makeSampleProject())).toEqual([]));

  it('meldet doppelte Ladepunkt-Bezeichnungen unabhängig von Groß-/Kleinschreibung', () => {
    const p = makeSampleProject();
    const [first, second] = p.chargePoints;
    if (!first || !second) throw new Error('Fixture');
    second.label = ' lp01';
    expect(checkProjectInvariants(p)).toEqual([
      {
        code: 'DUPLICATE_CP_LABEL',
        message: 'Ladepunkt-Bezeichnung „LP01“ ist 2-mal vergeben',
        targetIds: [first.id, second.id],
        path: ['chargePoints', 1, 'label'],
      },
    ]);
  });

  it('meldet doppelte IDs', () => {
    const p = makeSampleProject();
    const cluster = p.clusters[0];
    const group = p.groups[0];
    if (!cluster || !group) throw new Error('Fixture');
    p.groups.push({ ...group, id: cluster.id, name: 'Gäste' });
    const issue = checkProjectInvariants(p).find((i) => i.code === 'DUPLICATE_ID');
    expect(issue).toMatchObject({
      message: `ID ${cluster.id} ist 2-mal vergeben`,
      path: ['groups', 2, 'id'],
    });
  });

  it('meldet doppelte Clusternamen und doppelte Gruppennamen nur im selben Cluster', () => {
    const p = makeSampleProject();
    const second = makeCluster({ name: 'uv-tg1 · ebene −1' });
    p.clusters.push(second);
    p.groups.push(makeGroup(second.id, { name: 'Mieter' })); // anderer Cluster → erlaubt
    expect(codes(p)).toEqual(['DUPLICATE_CLUSTER_NAME']);
    p.groups.push(makeGroup(second.id, { name: 'MIETER' }));
    expect(codes(p)).toEqual(['DUPLICATE_CLUSTER_NAME', 'DUPLICATE_GROUP_NAME']);
  });

  it('meldet fehlende Referenzen', () => {
    const p = makeSampleProject();
    p.groups.push(makeGroup('0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', { name: 'Verwaist' }));
    p.chargePoints.push(makeChargePoint('0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c', { label: 'LP99' }));
    p.clusters.push(
      makeCluster({ name: 'UV-X', parentClusterId: '0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d' }),
    );
    const issues = checkProjectInvariants(p);
    expect(issues.map((i) => i.message)).toEqual([
      'Gruppe „Verwaist“ verweist auf einen Cluster, den es nicht gibt',
      'LP99 ist keiner vorhandenen Gruppe zugeordnet',
      'Cluster „UV-X“ verweist auf einen übergeordneten Cluster, den es nicht gibt',
    ]);
  });

  it('akzeptiert verschachtelte Cluster ohne Zyklus', () => {
    const p = makeSampleProject();
    const root = p.clusters[0];
    if (!root) throw new Error('Fixture');
    const child = makeCluster({ name: 'UV-TG1a', parentClusterId: root.id, limitA: 63 });
    p.clusters.push(
      child,
      makeCluster({ name: 'UV-TG1a1', parentClusterId: child.id, limitA: 35 }),
    );
    expect(checkProjectInvariants(p)).toEqual([]);
  });

  it('meldet einen Zyklus genau einmal', () => {
    const p = makeSampleProject();
    const a = makeCluster({ name: 'A' });
    const b = makeCluster({ name: 'B', parentClusterId: a.id });
    const c = makeCluster({ name: 'C', parentClusterId: b.id });
    a.parentClusterId = c.id;
    const tail = makeCluster({ name: 'D', parentClusterId: a.id }); // hängt am Zyklus, ist selbst keiner
    p.clusters.push(a, b, c, tail);
    const cycles = checkProjectInvariants(p).filter((i) => i.code === 'CLUSTER_CYCLE');
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.message).toBe('Cluster sind im Kreis verschachtelt: A › C › B › A');
    expect(new Set(cycles[0]?.targetIds)).toEqual(new Set([a.id, b.id, c.id]));
  });

  it('meldet Selbstverweis als Zyklus', () => {
    const p = makeSampleProject();
    const self = makeCluster({ name: 'S' });
    self.parentClusterId = self.id;
    p.clusters.push(self);
    expect(checkProjectInvariants(p).map((i) => i.message)).toEqual([
      'Cluster sind im Kreis verschachtelt: S › S',
    ]);
  });

  it.each([
    [{ minA: 5 }, 'LP01: Mindeststrom 5 A unter 6 A (IEC 61851)', 'minA'],
    [{ minA: 20, maxA: 16 }, 'LP01: Mindeststrom 20 A über Maximalstrom 16 A', 'minA'],
    [{ maxA: 40, fuseA: 32 }, 'LP01: Maximalstrom 40 A über Absicherung 32 A', 'maxA'],
    [
      { minA: 5.5, maxA: 40, fuseA: 32 },
      'LP01: Mindeststrom 5,5 A unter 6 A (IEC 61851); Maximalstrom 40 A über Absicherung 32 A',
      'minA',
    ],
  ])('prüft 6 A ≤ minA ≤ maxA ≤ fuseA: %o', (patch, message, field) => {
    const p = makeSampleProject();
    Object.assign(p.chargePoints[0] ?? {}, patch);
    expect(checkProjectInvariants(p)).toEqual([
      expect.objectContaining({
        code: 'CP_CURRENT_RANGE',
        message,
        path: ['chargePoints', 0, field],
      }),
    ]);
  });

  it('Grenzwerte sind zulässig (6 = minA = maxA = fuseA)', () => {
    const p = makeSampleProject();
    Object.assign(p.chargePoints[0] ?? {}, { minA: 6, maxA: 6, fuseA: 6 });
    expect(checkProjectInvariants(p)).toEqual([]);
  });
});

describe('StrictProjectSchema', () => {
  it('überträgt Invarianten als Zod-Fehler mit Pfad', () => {
    const p = makeSampleProject();
    Object.assign(p.chargePoints[2] ?? {}, { minA: 4 });
    const r = StrictProjectSchema.safeParse(p);
    expect(r.success).toBe(false);
    expect(r.error?.issues).toMatchObject([
      {
        path: ['chargePoints', 2, 'minA'],
        message: 'LP03: Mindeststrom 4 A unter 6 A (IEC 61851)',
      },
    ]);
  });
});
