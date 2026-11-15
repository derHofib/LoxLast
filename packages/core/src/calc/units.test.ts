import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { aFromKw, formatA, formatKw, formatNumber, kwFromA, roundForDisplay } from './units';

describe('Einheiten', () => {
  it('kwFromA', () => {
    expect(kwFromA(16, 3, 230)).toBeCloseTo(11.04, 10);
    expect(kwFromA(32, 3, 230)).toBeCloseTo(22.08, 10);
    expect(kwFromA(16, 1, 230)).toBeCloseTo(3.68, 10);
  });

  it('aFromKw', () => {
    expect(aFromKw(11.04, 3, 230)).toBeCloseTo(16, 10);
    expect(aFromKw(3.68, 1, 230)).toBeCloseTo(16, 10);
  });

  it('aFromKw ist die Umkehrung von kwFromA', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 6300, noNaN: true }),
        fc.constantFrom<1 | 3>(1, 3),
        fc.integer({ min: 100, max: 500 }),
        (a, phases, v) => {
          expect(aFromKw(kwFromA(a, phases, v), phases, v)).toBeCloseTo(a, 6);
        },
      ),
    );
  });
});

describe('Anzeigeformat', () => {
  it.each([
    [7.46, 7.5],
    [7.44, 7.4],
    [-0.04, 0],
    [-2.26, -2.3],
    [250, 250],
  ])('roundForDisplay(%d) = %d', (input, expected) =>
    expect(roundForDisplay(input)).toBe(expected),
  );

  it('deutsches Zahlenformat', () => {
    expect(formatNumber(1234.56)).toBe('1.234,6');
    expect(formatNumber(72)).toBe('72');
    expect(formatNumber(-0.04)).toBe('0');
  });

  it('Einheit mit geschütztem Leerzeichen', () => {
    expect(formatA(7.46)).toBe('7,5\u00a0A');
    expect(formatKw(22.08)).toBe('22,1\u00a0kW');
  });
});
