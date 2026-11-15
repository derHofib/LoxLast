import type { ReactNode } from 'react';

export interface PropertyPanelProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Eigenschaftsbereich (rechte Seitenleiste im Editor). */
export function PropertyPanel({ title, subtitle, children, footer }: PropertyPanelProps) {
  return (
    <aside className="lp-panel" aria-label={title}>
      <header className="lp-panel__header">
        <h2 className="lp-panel__title">{title}</h2>
        {subtitle ? <p className="lp-panel__sub">{subtitle}</p> : null}
      </header>
      <div className="lp-panel__body">{children}</div>
      {footer ? <footer className="lp-panel__footer">{footer}</footer> : null}
    </aside>
  );
}

export function PropertyGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="lp-group">
      <legend className="lp-group__title">{title}</legend>
      {children}
    </fieldset>
  );
}
