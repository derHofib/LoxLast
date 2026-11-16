import { describe, expect, it } from 'vitest';
import { makeChargePoint, makeCluster, makeGroup, makeSampleProject } from '../__tests__/fixtures';
import { checkProjectInvariants, ProjectSchema, type Project } from '../model';
import {
  addChargePoint,
  addCluster,
  addGroup,
  applyChangesInPlace,
  canNestCluster,
  deleteElements,
  descendantClusterIds,
  duplicateElements,
  moveChargePoints,
  moveCluster,
  moveGroups,
  nextChargePointLabel,
  suggestNextIp,
  updateChargePoints,
  updateCluster,
  updateGroup,
  updateSite,
  usedIps,
} from './operations';

let counter = 0;
const ids = () =>
  `0196a1b2-c3d4-7e5f-8a9b-${(0xe0000000 + counter++).toString(16).padStart(12, '0')}`;

/** Nach jeder Operation: Form gültig, keine Invariantenverletzung. */
function expectConsistent(p: Project) {
  expect(ProjectSchema.safeParse(p).success).toBe(true);
  expect(checkProjectInvariants(p)).toEqual([]);
}

describe('Vorschläge', () => {
  it('nächste Ladepunkt-Bezeichnung', () => {
    const p = makeSampleProject();
    expect(nextChargePointLabel(p)).toBe('LP04');
    expect(nextChargePointLabel({ chargePoints: [] })).toBe('LP01');
    expect(nextChargePointLabel(p, ['LP04'])).toBe('LP05');
    p.chargePoints[0]!.label = 'LP099';
    expect(nextChargePointLabel(p)).toBe('LP100');
    p.chargePoints[0]!.label = 'Tor Nord';
    expect(nextChargePointLabel(p)).toBe('LP04');
  });

  it('nächste freie IP im /24-Netz', () => {
    const p = makeSampleProject(); // .21, .22, .23
    expect(suggestNextIp(p)).toBe('192.168.10.24');
    expect(suggestNextIp(p, '192.168.10.20')).toBe('192.168.10.24');
    expect(suggestNextIp(p, '192.168.10.21', ['192.168.10.24'])).toBe('192.168.10.25');
    expect(suggestNextIp(p, '192.168.10.254')).toBeUndefined();
    expect(suggestNextIp({ ...p, chargePoints: [] })).toBeUndefined();
  });

  it('belegte IPs enthalten Zähler', () => {
    const p = makeSampleProject();
    p.site.gridMeter = {
      vendor: 'T',
      model: 'Z',
      protocol: 'modbus-tcp',
      network: { ip: '192.168.10.24', port: 502 },
    };
    p.site.pv = {
      meter: {
        vendor: 'T',
        model: 'PV',
        protocol: 'modbus-tcp',
        network: { ip: '192.168.10.25', port: 502 },
      },
    };
    expect(usedIps(p).has('192.168.10.25')).toBe(true);
    expect(suggestNextIp(p)).toBe('192.168.10.26');
  });
});

describe('Anlegen', () => {
  it('Cluster und Gruppe mit freien Standardnamen', () => {
    const p = makeSampleProject();
    const c = addCluster(p, { id: ids() });
    expect(c).toMatchObject({ name: 'UV-1', limitA: 63 });
    expect(addCluster(p, { id: ids() }).name).toBe('UV-2');
    const nested = addCluster(p, { id: ids(), name: 'UV-1a', limitA: 35, parentClusterId: c.id });
    expect(nested.parentClusterId).toBe(c.id);
    expect(addGroup(p, { id: ids(), clusterId: c.id })).toMatchObject({
      name: 'Gruppe 1',
      priority: 3,
    });
    expect(addGroup(p, { id: ids(), clusterId: c.id, name: 'Gäste', priority: 5 }).name).toBe(
      'Gäste',
    );
    expect(addGroup(p, { id: ids(), clusterId: c.id }).name).toBe('Gruppe 2');
    expectConsistent(p);
  });

  it('Ladepunkt übernimmt Werte vom letzten und zählt Bezeichnung und IP weiter', () => {
    const p = makeSampleProject();
    p.chargePoints[2] = { ...p.chargePoints[2]!, room: 'TG', category: 'Laden', fuseA: 25 };
    const cp = addChargePoint(p, { id: ids(), groupId: p.groups[0]!.id });
    expect(cp).toMatchObject({
      label: 'LP04',
      libraryModelId: 'test/wallbox@1',
      network: { ip: '192.168.10.24', port: 502, unitId: 1 },
      fuseA: 25,
      phases: 1,
      phaseRotation: 'L1-L2-L3',
      phaseSwitching: false,
      room: 'TG',
      category: 'Laden',
    });
    expectConsistent(p);
  });

  it('Ladepunkt ohne Vorlage mit Startwerten und expliziten Angaben', () => {
    const p = { ...makeSampleProject(), chargePoints: [] };
    const cp = addChargePoint(p, {
      id: ids(),
      groupId: p.groups[0]!.id,
      libraryModelId: 'test/wallbox@1',
      room: 'R',
      category: 'K',
      notes: 'N',
    });
    expect(cp).toMatchObject({
      label: 'LP01',
      network: { ip: '192.168.1.10', port: 502 },
      fuseA: 32,
      minA: 6,
      maxA: 16,
      phases: 3,
      room: 'R',
      category: 'K',
      notes: 'N',
    });
    expect(cp.network).not.toHaveProperty('unitId');
    expectConsistent(p);
  });
});

describe('Ändern', () => {
  it('Felder setzen und optionale Felder mit undefined entfernen', () => {
    const p = makeSampleProject();
    const fleet = p.groups[1]!;
    expect(updateGroup(p, fleet.id, { maxA: undefined, priority: 4 })).toBe(true);
    expect(fleet).not.toHaveProperty('maxA');
    expect(fleet.priority).toBe(4);
    expect(updateGroup(p, 'fehlt', { priority: 1 })).toBe(false);
    updateSite(p, { buildingReserveA: 50, gridMeter: undefined });
    expect(p.site.buildingReserveA).toBe(50);
    expect(updateCluster(p, p.clusters[0]!.id, { limitA: 100, phaseLimitA: [100, 80, 100] })).toBe(
      true,
    );
    expect(updateCluster(p, 'fehlt', { limitA: 1 })).toBe(false);
    expectConsistent(p);
  });

  it('Massenbearbeitung', () => {
    const p = makeSampleProject();
    const ids2 = p.chargePoints.slice(0, 2).map((c) => c.id);
    expect(updateChargePoints(p, ids2, { minA: 8, room: 'TG' })).toBe(2);
    expect(p.chargePoints.map((c) => c.minA)).toEqual([8, 8, 6]);
    expect(p.chargePoints[2]).not.toHaveProperty('room');
  });

  it('Netzwerk-Patch wird je Ladepunkt feldweise eingemischt', () => {
    const p = makeSampleProject();
    const ips = p.chargePoints.map((c) => c.network.ip);
    const both = p.chargePoints.slice(0, 2).map((c) => c.id);
    updateChargePoints(p, both, { network: { port: 1502, unitId: 7 } });
    expect(p.chargePoints.map((c) => c.network.ip)).toEqual(ips);
    expect(p.chargePoints.slice(0, 2).map((c) => [c.network.port, c.network.unitId])).toEqual([
      [1502, 7],
      [1502, 7],
    ]);
    updateChargePoints(p, both, { network: { unitId: undefined } });
    expect(p.chargePoints[0]!.network).not.toHaveProperty('unitId');
    expect(p.chargePoints[0]!.network.port).toBe(1502);
    expectConsistent(p);
  });

  it('Lösungsvorschlag anwenden', () => {
    const p = makeSampleProject();
    applyChangesInPlace(p, [
      {
        type: 'setPhaseRotation',
        chargePointId: p.chargePoints[2]!.id,
        from: 'L1-L2-L3',
        to: 'L3-L1-L2',
      },
      { type: 'setPhaseRotation', chargePointId: 'fehlt', from: 'L1-L2-L3', to: 'L3-L1-L2' },
    ]);
    expect(p.chargePoints[2]!.phaseRotation).toBe('L3-L1-L2');
  });
});

describe('Verschieben', () => {
  it('Ladepunkte in andere Gruppe, nur wenn das Ziel existiert', () => {
    const p = makeSampleProject();
    const [tenants, fleet] = p.groups;
    expect(
      moveChargePoints(
        p,
        p.chargePoints.map((c) => c.id),
        fleet!.id,
      ),
    ).toBe(2);
    expect(p.chargePoints.every((c) => c.groupId === fleet!.id)).toBe(true);
    expect(moveChargePoints(p, [p.chargePoints[0]!.id], 'fehlt')).toBe(0);
    expect(tenants).toBeDefined();
  });

  it('Gruppen in anderen Cluster', () => {
    const p = makeSampleProject();
    const other = addCluster(p, { id: ids(), name: 'UV-TG2' });
    expect(moveGroups(p, [p.groups[0]!.id], other.id)).toBe(1);
    expect(moveGroups(p, [p.groups[0]!.id], other.id)).toBe(0);
    expect(moveGroups(p, [p.groups[0]!.id], 'fehlt')).toBe(0);
    expectConsistent(p);
  });

  it('Cluster verschachteln ohne Zyklen', () => {
    const p = makeSampleProject();
    const a = p.clusters[0]!;
    const b = addCluster(p, { id: ids(), name: 'B', parentClusterId: a.id });
    const c = addCluster(p, { id: ids(), name: 'C', parentClusterId: b.id });
    expect(descendantClusterIds(p, a.id)).toEqual(new Set([b.id, c.id]));
    expect(canNestCluster(p, a.id, c.id)).toBe(false);
    expect(canNestCluster(p, a.id, a.id)).toBe(false);
    expect(canNestCluster(p, a.id, 'fehlt')).toBe(false);
    expect(canNestCluster(p, c.id, a.id)).toBe(true);
    expect(canNestCluster(p, c.id, undefined)).toBe(true);
    expect(moveCluster(p, a.id, c.id)).toBe(false);
    expect(updateCluster(p, a.id, { parentClusterId: c.id })).toBe(false);
    expect(moveCluster(p, c.id, a.id)).toBe(true);
    expect(moveCluster(p, c.id, a.id)).toBe(false); // schon dort
    expect(moveCluster(p, c.id, undefined)).toBe(true);
    expect(c).not.toHaveProperty('parentClusterId');
    expect(moveCluster(p, 'fehlt', undefined)).toBe(false);
    expectConsistent(p);
  });

  it('Nachfahren auch bei vorhandenem Zyklus endlich', () => {
    const p = makeSampleProject();
    const x = makeCluster({ name: 'X' });
    const y = makeCluster({ name: 'Y', parentClusterId: x.id });
    x.parentClusterId = y.id;
    p.clusters.push(x, y);
    expect(descendantClusterIds(p, x.id)).toEqual(new Set([y.id]));
  });
});

describe('Löschen', () => {
  it('kaskadiert Cluster → Unter-Cluster → Gruppen → Ladepunkte', () => {
    const p = makeSampleProject();
    const root = p.clusters[0]!;
    const child = addCluster(p, { id: ids(), name: 'Unter', parentClusterId: root.id });
    const g = addGroup(p, { id: ids(), clusterId: child.id });
    addChargePoint(p, { id: ids(), groupId: g.id });
    const other = addCluster(p, { id: ids(), name: 'Bleibt' });
    expect(deleteElements(p, [root.id])).toEqual({ clusters: 2, groups: 3, chargePoints: 4 });
    expect(p.clusters).toEqual([other]);
    expect(p.groups).toEqual([]);
    expect(p.chargePoints).toEqual([]);
  });

  it('Gruppe mit Ladepunkten, einzelner Ladepunkt, unbekannte IDs', () => {
    const p = makeSampleProject();
    expect(deleteElements(p, [p.groups[1]!.id, p.chargePoints[0]!.id, 'fehlt'])).toEqual({
      clusters: 0,
      groups: 1,
      chargePoints: 2,
    });
    expect(p.chargePoints.map((c) => c.label)).toEqual(['LP02']);
    expectConsistent(p);
  });
});

describe('Duplizieren', () => {
  it('Ladepunkt: neue ID, Bezeichnung und IP, gleiche Gruppe', () => {
    const p = makeSampleProject();
    const [copyId] = duplicateElements(p, [p.chargePoints[0]!.id], ids);
    const copy = p.chargePoints.find((c) => c.id === copyId);
    expect(copy).toMatchObject({
      label: 'LP04',
      groupId: p.groups[0]!.id,
      network: { ip: '192.168.10.24', port: 502, unitId: 1 },
    });
    expectConsistent(p);
  });

  it('mehrere Ladepunkte zählen weiter', () => {
    const p = makeSampleProject();
    duplicateElements(
      p,
      p.chargePoints.map((c) => c.id),
      ids,
    );
    expect(p.chargePoints.map((c) => [c.label, c.network.ip]).slice(3)).toEqual([
      ['LP04', '192.168.10.24'],
      ['LP05', '192.168.10.25'],
      ['LP06', '192.168.10.26'],
    ]);
    expectConsistent(p);
  });

  it('Gruppe mit Inhalt als „(Kopie)“', () => {
    const p = makeSampleProject();
    const [g1] = duplicateElements(p, [p.groups[0]!.id], ids);
    const [g2] = duplicateElements(p, [p.groups[0]!.id], ids);
    expect(p.groups.find((g) => g.id === g1)?.name).toBe('Mieter (Kopie)');
    expect(p.groups.find((g) => g.id === g2)?.name).toBe('Mieter (Kopie 2)');
    expect(p.chargePoints.filter((c) => c.groupId === g1)).toHaveLength(2);
    expectConsistent(p);
  });

  it('Cluster mit Gruppen, Ladepunkten und Unter-Clustern', () => {
    const p = makeSampleProject();
    const root = p.clusters[0]!;
    const child = addCluster(p, { id: ids(), name: 'Unter', parentClusterId: root.id });
    addGroup(p, { id: ids(), clusterId: child.id, name: 'Innen' });
    const [copyId] = duplicateElements(p, [root.id], ids);
    expect(p.clusters.map((c) => c.name)).toEqual([
      'UV-TG1 · Ebene −1',
      'Unter',
      'UV-TG1 · Ebene −1 (Kopie)',
      'Unter (Kopie)',
    ]);
    expect(p.clusters.find((c) => c.name === 'Unter (Kopie)')?.parentClusterId).toBe(copyId);
    expect(p.groups.filter((g) => g.clusterId === copyId).map((g) => g.name)).toEqual([
      'Mieter',
      'Flotte',
    ]);
    expect(p.chargePoints).toHaveLength(6);
    expectConsistent(p);
  });

  it('unbekannte IDs werden ignoriert', () => {
    const p = makeSampleProject();
    expect(duplicateElements(p, ['fehlt'])).toEqual([]);
    expect(makeChargePoint(p.groups[0]!.id)).toBeDefined();
    expect(makeGroup(p.clusters[0]!.id)).toBeDefined();
  });
});
