import { useId, type ReactNode } from 'react';

export interface PropertyPanelProps {
  title: string;
  subtitle?: string;
  /** Filterfeld oben (blendet Felder nach Name aus – Logik liegt beim Aufrufer). */
  filter?: { value: string; onChange: (v: string) => void };
  children: ReactNode;
  footer?: ReactNode;
}

/** Eigenschaftsbereich (rechte Seitenleiste im Editor). */
export function PropertyPanel({ title, subtitle, filter, children, footer }: PropertyPanelProps) {
  const filterId = useId();
  return (
    <aside className="lp-panel" aria-label={title}>
      <header className="lp-panel__header">
        <h2 className="lp-panel__title">{title}</h2>
        {subtitle ? <p className="lp-panel__sub">{subtitle}</p> : null}
        {filter ? (
          <div className="lp-panel__filter">
            <label className="lp-visually-hidden" htmlFor={filterId}>
              Eigenschaften filtern
            </label>
            <input
              id={filterId}
              type="search"
              className="lp-search__input"
              placeholder="Eigenschaften filtern"
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
            />
          </div>
        ) : null}
      </header>
      <div className="lp-panel__body">{children}</div>
      {footer ? <footer className="lp-panel__footer">{footer}</footer> : null}
    </aside>
  );
}

/** Abschnitt, z. B. „Häufig benötigt“: 12 px, Versalien, gesperrt, Trennlinie. */
export function PropertyGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="lp-group">
      <legend className="lp-group__title">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Aufklappbar, z. B. „Erweiterte Parameter“. */
export function PropertyAdvanced({
  title = 'Erweiterte Parameter',
  defaultOpen = false,
  children,
}: {
  title?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="lp-advanced" open={defaultOpen}>
      <summary className="lp-group__title lp-advanced__summary">{title}</summary>
      <div className="lp-group">{children}</div>
    </details>
  );
}
