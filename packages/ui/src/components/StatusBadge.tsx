import type { ReactNode } from 'react';

export type Status = 'ok' | 'warning' | 'error' | 'neutral';

const SYMBOL: Record<Status, string> = { ok: '●', warning: '▲', error: '■', neutral: '○' };

/** Status mit Symbol UND Text – nie nur Farbe (Kap. 10.3). */
export function StatusBadge({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className={`lp-status lp-status--${status}`}>
      <span className="lp-status__sym" aria-hidden="true">
        {SYMBOL[status]}
      </span>
      {children}
    </span>
  );
}
