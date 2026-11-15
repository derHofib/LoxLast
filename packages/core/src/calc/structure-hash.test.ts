import { describe, expect, it } from 'vitest';
import { makeChargePoint, makeSampleProject } from '../__tests__/fixtures';
import type { Project } from '../model';
import { canonicalJson, fnv1a64, structureHash } from './structure-hash';

describe('fnv1a64', () => {
  it('bekannte Prüfwerte', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('ä€𝄞')).toBe('f505d6ab20047207'); // 2-, 3- und 4-Byte-UTF-8
  });
});

describe('canonicalJson', () => {
  it('sortiert Schlüssel und lässt undefined weg', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined })).toBe(
      '{"a":[true,null,"x"],"b":1}',
    );
  });
});

describe('structureHash', () => {
  const base = makeSampleProject();
  const hash = structureHash(base);
  const mutate = (fn: (p: Project) => void) => {
    const p = JSON.parse(JSON.stringify(base)) as Project;
    fn(p);
    return p;
  };

  it('Format', () => expect(hash).toMatch(/^v1:[0-9a-f]{16}$/));

  it('unabhängig von Reihenfolge der Listen', () => {
    expect(
      structureHash({
        ...base,
        chargePoints: [...base.chargePoints].reverse(),
        groups: [...base.groups].reverse(),
      }),
    ).toBe(hash);
  });

  it.each<[string, (p: Project) => void]>([
    ['Grenzwerte', (p) => Object.assign(p.chargePoints[0] ?? {}, { minA: 8, maxA: 20, fuseA: 40 })],
    ['Priorität', (p) => Object.assign(p.groups[0] ?? {}, { priority: 5, maxA: 40 })],
    ['Cluster-Limit', (p) => Object.assign(p.clusters[0] ?? {}, { limitA: 63 })],
    [
      'Netzanschluss und Reserve',
      (p) => Object.assign(p.site, { gridConnectionFuseA: 400, buildingReserveA: 10 }),
    ],
    [
      'Phasenrotation',
      (p) => Object.assign(p.chargePoints[0] ?? {}, { phaseRotation: 'L3-L1-L2' }),
    ],
    ['Notizen und Kunde', (p) => Object.assign(p, { notes: 'x', customer: 'y', name: 'Neu' })],
  ])('nicht strukturrelevant: %s', (_, fn) => expect(structureHash(mutate(fn))).toBe(hash));

  it.each<[string, (p: Project) => void]>([
    [
      'Ladepunkt neu',
      (p) =>
        p.chargePoints.push(
          makeChargePoint(p.groups[0]?.id ?? '', {
            label: 'LP10',
            network: { ip: '192.168.10.40', port: 502 },
          }),
        ),
    ],
    ['Bezeichnung', (p) => Object.assign(p.chargePoints[0] ?? {}, { label: 'LP99' })],
    [
      'IP-Adresse',
      (p) =>
        Object.assign(p.chargePoints[0] ?? {}, {
          network: { ip: '192.168.10.99', port: 502, unitId: 1 },
        }),
    ],
    [
      'Unit-ID',
      (p) =>
        Object.assign(p.chargePoints[0] ?? {}, { network: { ip: '192.168.10.21', port: 502 } }),
    ],
    [
      'Gruppenzuordnung',
      (p) => Object.assign(p.chargePoints[0] ?? {}, { groupId: p.groups[1]?.id }),
    ],
    ['Modell', (p) => Object.assign(p.chargePoints[0] ?? {}, { libraryModelId: 'test/andere@1' })],
    ['Gruppenname', (p) => Object.assign(p.groups[0] ?? {}, { name: 'Gäste' })],
    [
      'Cluster verschachtelt',
      (p) => Object.assign(p.clusters[0] ?? {}, { parentClusterId: p.groups[0]?.id }),
    ],
    [
      'Netzzähler',
      (p) =>
        Object.assign(p.site, {
          gridMeter: {
            vendor: 'X',
            model: 'Y',
            protocol: 'modbus-tcp',
            network: { ip: '192.168.10.5', port: 502 },
          },
        }),
    ],
    ['Benennungsschema', (p) => Object.assign(p.settings.namingScheme, { wallbox: 'EV_{label}' })],
    ['Raum', (p) => Object.assign(p.chargePoints[0] ?? {}, { room: 'Tiefgarage' })],
  ])('strukturrelevant: %s', (_, fn) => expect(structureHash(mutate(fn))).not.toBe(hash));
});
