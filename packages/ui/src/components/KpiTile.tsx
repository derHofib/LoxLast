import type { ReactNode } from 'react';

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  /** Oberkante: grün (Standard) bzw. orange bei Störung. */
  tone?: 'ok' | 'warning';
}

export function KpiTile({ label, value, unit, sub, tone = 'ok' }: KpiTileProps) {
  return (
    <div className={`lp-kpi lp-kpi--${tone}`}>
      <div className="lp-kpi__label">{label}</div>
      <div className="lp-kpi__value">
        {value}
        {unit ? <span className="lp-kpi__unit"> {unit}</span> : null}
      </div>
      {sub ? <div className="lp-kpi__sub">{sub}</div> : null}
    </div>
  );
}
