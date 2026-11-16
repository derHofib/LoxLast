import { createProject, newId, type ChargePoint, type Project } from '@lastplan/core';

/**
 * Kleine Testanlage (nur für Tests): UV-TG1 mit Gruppen Mieter (LP01, LP02) und Flotte (LP03).
 * Modell-ID ist ein Testmodell, kein reales Wallbox-Modell.
 */
export function sampleProject(): Project {
  const project = createProject({ name: 'Testanlage' });
  const clusterId = newId();
  const tenants = newId();
  const fleet = newId();
  const cp = (
    label: string,
    groupId: string,
    host: number,
    extra: Partial<ChargePoint> = {},
  ): ChargePoint => ({
    id: newId(),
    label,
    groupId,
    libraryModelId: 'test/wallbox@1',
    network: { ip: `192.168.10.${host}`, port: 502, unitId: 1 },
    protocol: 'modbus-tcp',
    fuseA: 32,
    minA: 6,
    maxA: 16,
    phases: 3,
    phaseRotation: 'L1-L2-L3',
    phaseSwitching: false,
    ...extra,
  });
  return {
    ...project,
    site: { gridConnectionFuseA: 250, gridConnectionLabel: 'HAK 250 A', buildingReserveA: 80 },
    clusters: [{ id: clusterId, name: 'UV-TG1', limitA: 125 }],
    groups: [
      { id: tenants, name: 'Mieter', clusterId, priority: 2 },
      { id: fleet, name: 'Flotte', clusterId, priority: 1, maxA: 63 },
    ],
    chargePoints: [
      cp('LP01', tenants, 21),
      cp('LP02', tenants, 22, { phaseRotation: 'L2-L3-L1' }),
      cp('LP03', fleet, 23, { phases: 1 }),
    ],
  };
}
