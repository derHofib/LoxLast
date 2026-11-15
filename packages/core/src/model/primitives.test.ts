import { describe, expect, it } from 'vitest';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';
import {
  AmpereSchema,
  IdSchema,
  IpV4Schema,
  NetworkEndpointSchema,
  PhaseRotationSchema,
  PortSchema,
  PositiveAmpereSchema,
  UnitIdSchema,
  requiredText,
} from './primitives';

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message) ?? [];

describe('IdSchema', () => {
  it('akzeptiert UUID v7', () => expect(IdSchema.safeParse(uuidv7()).success).toBe(true));
  it('lehnt UUID v4 ab', () => {
    const r = IdSchema.safeParse(uuidv4());
    expect(r.success).toBe(false);
    expect(messages(r)).toEqual(['Ungültige ID (UUID v7 erwartet)']);
  });
});

describe('Ströme', () => {
  it.each([0, 6, 32, 6300])('akzeptiert %d A', (a) =>
    expect(AmpereSchema.safeParse(a).success).toBe(true),
  );
  it('lehnt negative Werte ab', () =>
    expect(messages(AmpereSchema.safeParse(-1))).toEqual(['Strom darf nicht negativ sein']));
  it('lehnt unplausibel große Werte ab', () =>
    expect(messages(AmpereSchema.safeParse(6301))).toEqual(['Strom über 6300 A ist unplausibel']));
  it('lehnt NaN und Unendlich ab', () => {
    expect(AmpereSchema.safeParse(Number.NaN).success).toBe(false);
    expect(AmpereSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });
  it('PositiveAmpere lehnt 0 ab', () =>
    expect(messages(PositiveAmpereSchema.safeParse(0))).toEqual([
      'Strom muss größer als 0 A sein',
    ]));
});

describe('Netzwerk', () => {
  it.each(['192.168.1.20', '10.0.0.1', '255.255.255.255'])('akzeptiert IP %s', (ip) =>
    expect(IpV4Schema.safeParse(ip).success).toBe(true),
  );
  it.each(['192.168.1.256', '192.168.1', 'wallbox.local', ''])('lehnt IP „%s“ ab', (ip) =>
    expect(messages(IpV4Schema.safeParse(ip))).toEqual([
      'Ungültige IPv4-Adresse (Beispiel: 192.168.1.20)',
    ]),
  );
  it.each([1, 502, 65535])('akzeptiert Port %d', (p) =>
    expect(PortSchema.safeParse(p).success).toBe(true),
  );
  it.each([0, 65536, 502.5])('lehnt Port %d ab', (p) =>
    expect(PortSchema.safeParse(p).success).toBe(false),
  );
  it.each([0, 1, 247])('akzeptiert Unit-ID %d', (u) =>
    expect(UnitIdSchema.safeParse(u).success).toBe(true),
  );
  it.each([-1, 248, 1.5])('lehnt Unit-ID %d ab', (u) =>
    expect(UnitIdSchema.safeParse(u).success).toBe(false),
  );
  it('Unit-ID ist optional', () =>
    expect(NetworkEndpointSchema.safeParse({ ip: '192.168.1.20', port: 502 }).success).toBe(true));
});

describe('Phasenlage', () => {
  it.each(['L1-L2-L3', 'L2-L3-L1', 'L3-L1-L2'])('akzeptiert %s', (r) =>
    expect(PhaseRotationSchema.safeParse(r).success).toBe(true),
  );
  it('lehnt ungültige Drehung ab', () =>
    expect(messages(PhaseRotationSchema.safeParse('L1-L3-L2'))).toEqual([
      'Phasenlage muss L1-L2-L3, L2-L3-L1 oder L3-L1-L2 sein',
    ]));
});

describe('requiredText', () => {
  const schema = requiredText('Clustername');
  it('trimmt', () => expect(schema.parse('  UV-TG1 ')).toBe('UV-TG1'));
  it('lehnt leeren Text ab', () =>
    expect(messages(schema.safeParse('   '))).toEqual(['Clustername darf nicht leer sein']));
  it('lehnt zu langen Text ab', () =>
    expect(messages(schema.safeParse('x'.repeat(201)))).toEqual([
      'Clustername ist zu lang (max. 200 Zeichen)',
    ]));
});
