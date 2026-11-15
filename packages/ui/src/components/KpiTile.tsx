import type { ReactNode } from 'react';

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
}

export function KpiTile({ label, value, unit, sub }: KpiTileProps) {
  return (
    <div className="lp-kpi">
      <div className="lp-kpi__label">{label}</div>
      <div className="lp-kpi__value">
        {value}
        {unit ? <span className="lp-kpi__unit"> {unit}</span> : null}
      </div>
      {sub ? <div className="lp-kpi__sub">{sub}</div> : null}
    </div>
  );
}
