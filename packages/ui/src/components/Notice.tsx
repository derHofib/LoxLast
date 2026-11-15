import type { ReactNode } from 'react';

export type NoticeKind = 'error' | 'warning' | 'info';

export interface NoticeProps {
  kind: NoticeKind;
  title: string;
  children?: ReactNode;
  /** Lösungsvorschlag – Fehlermeldungen nennen immer einen Ausweg (Kap. 1). */
  solution?: string;
  actions?: ReactNode;
  /** Banner = volle Breite, z. B. für Verbindungs-/Speicherstatus. */
  banner?: boolean;
}

export function Notice({ kind, title, children, solution, actions, banner }: NoticeProps) {
  return (
    <div
      className={`lp-notice lp-notice--${kind}${banner ? ' lp-notice--banner' : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <div className="lp-notice__body">
        <strong className="lp-notice__title">{title}</strong>
        {children ? <div className="lp-notice__text">{children}</div> : null}
        {solution ? <div className="lp-notice__solution">Lösung: {solution}</div> : null}
      </div>
      {actions ? <div className="lp-notice__actions">{actions}</div> : null}
    </div>
  );
}
