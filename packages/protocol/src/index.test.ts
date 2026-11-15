import { describe, expect, it } from 'vitest';
import {
  ChangelogQuerySchema,
  ClientMessageSchema,
  DeviceTestRequestSchema,
  HostSchema,
  NetworkEndpointSchema,
  ParametersRequestSchema,
  HealthResponseSchema,
  PairRequestSchema,
  ServerMessageSchema,
} from './index';

describe('HealthResponseSchema', () => {
  it('akzeptiert gültige Antwort', () =>
    expect(
      HealthResponseSchema.safeParse({
        status: 'ok',
        service: 'lastplan-gateway',
        version: '0.1.0',
      }).success,
    ).toBe(true));
  it('lehnt fremde Dienste ab', () =>
    expect(
      HealthResponseSchema.safeParse({ status: 'ok', service: 'x', version: '0.1.0' }).success,
    ).toBe(false));
});

describe('PairRequestSchema', () => {
  it('normalisiert Groß-/Kleinschreibung und Leerraum', () =>
    expect(PairRequestSchema.parse({ code: ' abcd-2345 ' }).code).toBe('ABCD-2345'));
  it.each(['ABCD2345', 'ABCD-234', 'OOOO-1111', ''])('lehnt %j ab', (code) =>
    expect(PairRequestSchema.safeParse({ code }).success).toBe(false),
  );
});

describe('Netzwerk-Validierung', () => {
  it('Port 1–65535, Unit-ID 0–247, IPv4', () => {
    const ep = (o: object) =>
      NetworkEndpointSchema.safeParse({ ip: '10.0.0.5', port: 502, ...o }).success;
    expect(ep({})).toBe(true);
    expect(ep({ unitId: 0 })).toBe(true);
    expect(ep({ unitId: 247 })).toBe(true);
    expect(ep({ unitId: 248 })).toBe(false);
    expect(ep({ port: 0 })).toBe(false);
    expect(ep({ port: 65536 })).toBe(false);
    expect(ep({ ip: '999.1.1.1' })).toBe(false);
    expect(ep({ ip: 'wallbox.local' })).toBe(false);
  });
  it('Host: Hostname oder IP, ohne Schema/Port', () => {
    for (const ok of ['192.168.1.2', 'ms.example.de', 'abc123.dyndns.loxonecloud.com'])
      expect(HostSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['http://x.de', 'x.de:80', '-x.de', 'x..de', '', 'a b'])
      expect(HostSchema.safeParse(bad).success).toBe(false);
  });
  it('Geräte-Test braucht gültige Bibliotheks-ID', () => {
    const base = { endpoint: { ip: '10.0.0.5', port: 502 } };
    expect(
      DeviceTestRequestSchema.safeParse({ ...base, libraryModelId: 'abl/em4-twin@1' }).success,
    ).toBe(true);
    expect(DeviceTestRequestSchema.safeParse({ ...base, libraryModelId: '../x' }).success).toBe(
      false,
    );
  });
});

describe('Parameter-Schreiben', () => {
  it('1–200 Änderungen, endliche Werte', () => {
    expect(ParametersRequestSchema.safeParse({ changes: [] }).success).toBe(false);
    expect(
      ParametersRequestSchema.safeParse({ changes: [{ name: 'LIM', value: 16 }], confirm: true })
        .success,
    ).toBe(true);
    expect(
      ParametersRequestSchema.safeParse({ changes: [{ name: 'LIM', value: Infinity }] }).success,
    ).toBe(false);
  });
});

describe('Changelog-Abfrage', () => {
  it('Standardlimit 100', () => expect(ChangelogQuerySchema.parse({}).limit).toBe(100));
  it('begrenzt auf 500', () =>
    expect(ChangelogQuerySchema.safeParse({ limit: '501' }).success).toBe(false));
});

describe('WebSocket-Nachrichten', () => {
  it('auth braucht Token', () => {
    expect(ClientMessageSchema.safeParse({ type: 'auth', token: 'x' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'auth', token: 'x'.repeat(30) }).success).toBe(
      true,
    );
  });
  it('unbekannter Typ wird abgelehnt', () => {
    expect(ClientMessageSchema.safeParse({ type: 'boom' }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'pong' }).success).toBe(true);
  });
  it('Server-Nachrichten aus Kap. 8.3 sind spezifiziert', () => {
    const cp = {
      label: 'LP01',
      status: null,
      setpointA: 16,
      currentA: [1, 2, null],
      powerKw: 3.7,
      fault: false,
    };
    const at = '2026-11-15T22:00:00.000Z';
    const res = { name: 'LIM', ok: true, readBack: 16 };
    for (const m of [
      { type: 'live.update', projectId: 'p', at, chargePoint: cp },
      { type: 'miniserver.state', status: { state: 'disconnected', lastValuesAt: at } },
      { type: 'parameter.applied', projectId: 'p', result: res },
      {
        type: 'parameter.failed',
        projectId: 'p',
        result: { ...res, ok: false },
        message: 'Abweichung',
      },
      { type: 'structure.mismatch', projectId: 'p', message: 'LP10 neu' },
    ])
      expect(ServerMessageSchema.safeParse(m).success).toBe(true);
  });
});
