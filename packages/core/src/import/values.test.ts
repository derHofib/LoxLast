import { describe, expect, it } from 'vitest';
import {
  parseBoolean,
  parseDecimal,
  parseInteger,
  parseIpv4,
  parsePhaseRotation,
  parsePhases,
  parseProtocol,
} from './values';

describe('parseDecimal', () => {
  it.each([
    ['16', 16],
    ['16,0', 16],
    ['16 A', 16],
    ['16A', 16],
    [' 6,5 a ', 6.5],
    ['16.5', 16.5],
    ['-3', -3],
    ['+7', 7],
  ])('%j → %d', (text, value) => expect(parseDecimal(text, 'A')).toBe(value));

  it.each(['', 'A', 'abc', '1.000,5', '16 kW', '1,2,3', '16 A A', ',5'])('lehnt %j ab', (text) =>
    expect(parseDecimal(text, 'A')).toBeUndefined(),
  );

  it('ohne Einheit wird „A“ nicht entfernt', () => expect(parseDecimal('16 A')).toBeUndefined());
});

describe('parseInteger', () => {
  it('nimmt ganze Zahlen, auch „502,0“', () => {
    expect(parseInteger('502')).toBe(502);
    expect(parseInteger('502,0')).toBe(502);
    expect(parseInteger('502,5')).toBeUndefined();
    expect(parseInteger('x')).toBeUndefined();
  });
});

describe('parseIpv4', () => {
  it.each(['192.168.1.20', '0.0.0.0', '255.255.255.255', ' 10.0.0.1 '])('gültig: %j', (ip) =>
    expect(parseIpv4(ip)).toBe(ip.trim()),
  );
  it.each([
    '192.168.1.300',
    '192.168.1',
    '192.168.1.1.1',
    '192.168.01.1',
    '192.168.1.-1',
    '192.168.1.a',
    '192.168. 1.1',
    '',
  ])('ungültig: %j', (ip) => expect(parseIpv4(ip)).toBeUndefined());
});

describe('parsePhaseRotation', () => {
  it.each([
    ['L1-L2-L3', 'L1-L2-L3'],
    ['l2 l3 l1', 'L2-L3-L1'],
    ['L3/L1/L2', 'L3-L1-L2'],
    ['231', 'L2-L3-L1'],
    ['L1L2L3', 'L1-L2-L3'],
  ])('%j → %s', (text, rotation) => expect(parsePhaseRotation(text)).toBe(rotation));

  it.each(['L1-L3-L2', 'L1-L1-L2', 'L4-L1-L2', 'L1', 'abc', ''])('lehnt %j ab', (text) =>
    expect(parsePhaseRotation(text)).toBeUndefined(),
  );
});

describe('parsePhases', () => {
  it.each([
    ['1', 1],
    ['3', 3],
    ['3-phasig', 3],
    ['einphasig', 1],
    ['Dreiphasig', 3],
    ['3,0', 3],
  ])('%j → %d', (text, n) => expect(parsePhases(text)).toBe(n));
  it.each(['2', '0', 'drei', ''])('lehnt %j ab', (text) =>
    expect(parsePhases(text)).toBeUndefined(),
  );
});

describe('parseBoolean', () => {
  it('versteht ja/nein in Deutsch und Englisch', () => {
    expect(['ja', 'JA', 'x', 'true', '1', 'yes'].map(parseBoolean)).toEqual(Array(6).fill(true));
    expect(['nein', 'Nein', 'false', '0', 'no', '-'].map(parseBoolean)).toEqual(
      Array(6).fill(false),
    );
    expect(parseBoolean('vielleicht')).toBeUndefined();
  });
});

describe('parseProtocol', () => {
  it.each([
    ['Modbus TCP', 'modbus-tcp'],
    ['modbus-tcp', 'modbus-tcp'],
    ['Modbus', 'modbus-tcp'],
    ['HTTP', 'http'],
    ['OCPP', 'ocpp-bridge'],
    ['ocpp_bridge', 'ocpp-bridge'],
  ])('%j → %s', (text, p) => expect(parseProtocol(text)).toBe(p));
  it('lehnt Unbekanntes ab', () => expect(parseProtocol('https')).toBeUndefined());
});
