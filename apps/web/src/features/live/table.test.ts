import type { LiveChargePoint } from '@lastplan/protocol';
import { describe, expect, it } from 'vitest';
import { arrange, kpis } from './table';

const row = (label: string, over: Partial<LiveChargePoint> = {}): LiveChargePoint => ({
  label,
  status: null,
  setpointA: null,
  currentA: [null, null, null],
  powerKw: null,
  fault: false,
  ...over,
});
const rows = [
  row('LP10', { powerKw: 7.4, currentA: [10, 10, 10], setpointA: 10 }),
  row('LP2', { fault: true }),
  row('LP1', { powerKw: 3.7, setpointA: 16 }),
];

describe('Live-Tabelle', () => {
  it('sortiert natürlich nach Bezeichnung', () => {
    expect(arrange(rows, 'all', '', 'label', 'asc').map((r) => r.label)).toEqual([
      'LP1',
      'LP2',
      'LP10',
    ]);
  });
  it('stellt fehlende Werte ans Ende, auch absteigend', () => {
    expect(arrange(rows, 'all', '', 'powerKw', 'desc').map((r) => r.label)).toEqual([
      'LP10',
      'LP1',
      'LP2',
    ]);
  });
  it('filtert Störungen, Ladende und Suche', () => {
    expect(arrange(rows, 'fault', '', 'label', 'asc').map((r) => r.label)).toEqual(['LP2']);
    expect(arrange(rows, 'charging', '', 'label', 'asc')).toHaveLength(2);
    expect(arrange(rows, 'all', 'lp1', 'label', 'asc').map((r) => r.label)).toEqual([
      'LP1',
      'LP10',
    ]);
  });
  it('summiert Kennzahlen', () => {
    expect(kpis(rows)).toEqual({ total: 3, charging: 2, faults: 1, powerKw: 11.1 });
  });
});
