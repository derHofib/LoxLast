import type { ReactNode } from 'react';

/** aktiv = grüner gefüllter Punkt · bereit = grau umrandeter Punkt · Hinweis/Fehler = Warndreieck. */
export type Status = 'active' | 'ready' | 'warning' | 'error';

function Symbol({ status }: { status: Status }) {
  if (status === 'warning' || status === 'error') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          d="M7 1.5 13 12H1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M7 5.5v3M7 10v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle
        cx="5"
        cy="5"
        r={status === 'active' ? 5 : 4}
        fill={status === 'active' ? 'var(--color-accent)' : 'none'}
        stroke={status === 'active' ? 'none' : 'var(--color-io-param)'}
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Status mit Symbol UND Text – nie nur Farbe (Kap. 10.3). */
export function StatusBadge({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className={`lp-status lp-status--${status}`}>
      <Symbol status={status} />
      {children}
    </span>
  );
}
