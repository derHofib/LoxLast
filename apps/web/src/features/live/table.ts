import type { LiveChargePoint } from '@lastplan/protocol';

export type SortKey = 'label' | 'status' | 'setpointA' | 'powerKw' | 'fault';
export type SortDir = 'asc' | 'desc';
export type RowFilter = 'all' | 'fault' | 'charging';

/** Ladend = Leistung oder Strom einer Phase größer 0 (kein Statuscode nötig). */
export function isCharging(r: LiveChargePoint): boolean {
  return (r.powerKw ?? 0) > 0 || r.currentA.some((a) => (a ?? 0) > 0);
}

const collator = new Intl.Collator('de', { numeric: true });

const value = (r: LiveChargePoint, key: SortKey): string | number | null =>
  key === 'fault' ? (r.fault ? 1 : 0) : r[key];

/** Filtern und sortieren; fehlende Werte stehen immer am Ende. */
export function arrange(
  rows: readonly LiveChargePoint[],
  filter: RowFilter,
  search: string,
  key: SortKey,
  dir: SortDir,
): LiveChargePoint[] {
  const q = search.trim().toLowerCase();
  const out = rows.filter(
    (r) =>
      (filter === 'all' || (filter === 'fault' ? r.fault : isCharging(r))) &&
      (q === '' || r.label.toLowerCase().includes(q)),
  );
  const sign = dir === 'asc' ? 1 : -1;
  return out.sort((a, b) => {
    const x = value(a, key);
    const y = value(b, key);
    if (x === null && y === null) return collator.compare(a.label, b.label);
    if (x === null) return 1;
    if (y === null) return -1;
    const c =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : collator.compare(String(x), String(y));
    return c === 0 ? collator.compare(a.label, b.label) : c * sign;
  });
}

export interface Kpis {
  total: number;
  charging: number;
  faults: number;
  powerKw: number;
}

export function kpis(rows: readonly LiveChargePoint[]): Kpis {
  return {
    total: rows.length,
    charging: rows.filter(isCharging).length,
    faults: rows.filter((r) => r.fault).length,
    powerKw: Math.round(rows.reduce((s, r) => s + (r.powerKw ?? 0), 0) * 10) / 10,
  };
}
