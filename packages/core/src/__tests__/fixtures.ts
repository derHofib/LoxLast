import { v7 as uuidv7 } from 'uuid';
import type { ChargePoint, Cluster, Group, Project } from '../model/project';
import { createProject } from '../model/factory';

/** Feste Uhrzeit für reproduzierbare Tests. */
export const FIXED_NOW = () => new Date('2026-11-15T12:00:00.000Z');

export function makeCluster(overrides: Partial<Cluster> = {}): Cluster {
  return { id: uuidv7(), name: 'UV-TG1 · Ebene −1', limitA: 125, ...overrides };
}

export function makeGroup(clusterId: string, overrides: Partial<Group> = {}): Group {
  return { id: uuidv7(), name: 'Mieter', clusterId, priority: 2, ...overrides };
}

export function makeChargePoint(
  groupId: string,
  overrides: Partial<ChargePoint> = {},
): ChargePoint {
  return {
    id: uuidv7(),
    label: 'LP01',
    groupId,
    libraryModelId: 'abl/em4-twin@1',
    network: { ip: '192.168.10.21', port: 502, unitId: 1 },
    protocol: 'modbus-tcp',
    fuseA: 32,
    minA: 6,
    maxA: 16,
    phases: 3,
    phaseRotation: 'L1-L2-L3',
    phaseSwitching: false,
    ...overrides,
  };
}

/** Kleine, fachlich gültige Anlage: 1 Cluster, 2 Gruppen, 3 Ladepunkte. */
export function makeSampleProject(): Project {
  const project = createProject({ name: 'Tiefgarage Musterstraße', now: FIXED_NOW });
  const cluster = makeCluster();
  const tenants = makeGroup(cluster.id, { name: 'Mieter', priority: 2 });
  const fleet = makeGroup(cluster.id, { name: 'Flotte', priority: 1, maxA: 63 });
  return {
    ...project,
    site: {
      gridConnectionFuseA: 250,
      gridConnectionLabel: 'HAK · 250 A NH2',
      buildingReserveA: 80,
    },
    clusters: [cluster],
    groups: [tenants, fleet],
    chargePoints: [
      makeChargePoint(tenants.id, { label: 'LP01' }),
      makeChargePoint(tenants.id, {
        label: 'LP02',
        network: { ip: '192.168.10.22', port: 502, unitId: 1 },
        phaseRotation: 'L2-L3-L1',
      }),
      makeChargePoint(fleet.id, {
        label: 'LP03',
        network: { ip: '192.168.10.23', port: 502, unitId: 1 },
        phases: 1,
      }),
    ],
  };
}
